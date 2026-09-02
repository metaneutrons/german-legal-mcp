import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LegisProvider } from './index.js';
import type { LegisAdapter, TocEntry } from './types.js';

const LONG = 'Dies ist der materielle Inhalt des Paragraphen mit ausreichender Länge. ';
const DOC_CONTENT =
  '# Allgemeines\n'
  + `## § 1 Zweck\n${LONG.repeat(3)}\n`
  + `## § 2 Geltungsbereich\n${LONG.repeat(3)}\n`
  + `### Art. 3 Sonderfall\n${LONG.repeat(2)}\n`;

// Heading-extraction adapter (no toc()).
const flat: LegisAdapter = {
  states: ['XX'] as unknown as LegisAdapter['states'],
  search: vi.fn(async () => [{ id: 'g1', title: 'Gesetz', subtitle: 'Kurz', date: '2020' }]),
  get: vi.fn(async () => ({ title: 'Gesetz X', content: DOC_CONTENT, url: 'http://x/g1' })),
};

// Adapter providing its own toc().
const tocEntries: TocEntry[] = [
  { depth: 0, num: '§ 1', title: 'Zweck' },
  { depth: 1, num: '', title: 'Unterpunkt' },
];
const structured: LegisAdapter = {
  states: ['YY'] as unknown as LegisAdapter['states'],
  search: vi.fn(async () => []),
  get: vi.fn(async () => ({ title: 'Y', content: DOC_CONTENT, url: 'http://y' })),
  toc: vi.fn(async () => tocEntries),
};

function provider(): LegisProvider {
  return new LegisProvider([flat, structured]);
}

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe('LegisProvider', () => {
  it('dispatches search and formats results', async () => {
    const res = await provider().handleToolCall('legis_search', { query: 'q', state: 'XX' });
    expect(res.content[0].text).toContain('Found 1 results');
    expect(res.content[0].text).toContain('`g1`');
  });

  it('returns an empty search response without marking it as an error', async () => {
    const res = await provider().handleToolCall('legis_search', {
      query: 'Kammergesetz Heilberufe',
      state: 'YY',
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain('Found 0 results');
  });

  it('renders a document and saves it to a file', async () => {
    const res = await provider().handleToolCall('legis_get', { id: 'g1', state: 'XX' });
    expect(res.content[0].text).toContain('# Gesetz X');
    expect(res.content[0].text).toContain('**Source:** http://x/g1');

    const exportRoot = join(process.env.GLMCP_STATE_DIR!, 'exports');
    await mkdir(exportRoot, { recursive: true });
    const dir = await mkdtemp(join(exportRoot, 'legis-')); dirs.push(dir);
    const file = join(dir, 'g.md');
    const saved = await provider().handleToolCall('legis_get', { id: 'g1', state: 'XX', save_path: file });
    expect(saved.content[0].text).toMatch(/saved|gespeichert|→|wrote/i);
    expect(await readFile(file, 'utf-8')).toContain('Gesetz X');
  });

  it('extracts a TOC from document headings with depth and range filters', async () => {
    const all = await provider().handleToolCall('legis_toc', { id: 'g1', state: 'XX' });
    expect(all.content[0].text).toContain('§ 1 Zweck');
    expect(all.content[0].text).toContain('Art. 3 Sonderfall');

    const shallow = await provider().handleToolCall('legis_toc', { id: 'g1', state: 'XX', depth: 1 });
    expect(shallow.content[0].text).not.toContain('Art. 3'); // depth 2 filtered out

    const ranged = await provider().handleToolCall('legis_toc', { id: 'g1', state: 'XX', from: '§ 1', to: '§ 2' });
    expect(ranged.content[0].text).toContain('§ 1');
    expect(ranged.content[0].text).toContain('§ 2');
    expect(ranged.content[0].text).not.toContain('Art. 3');
  });

  it('uses an adapter-provided toc() when available', async () => {
    const res = await provider().handleToolCall('legis_toc', { id: 'x', state: 'YY' });
    expect(structured.toc).toHaveBeenCalledWith('YY', 'x');
    expect(res.content[0].text).toContain('§ 1 Zweck');
    expect(res.content[0].text).toContain('**Unterpunkt**'); // num-less entry rendered bold
  });

  it('lists supported jurisdictions', async () => {
    const res = await provider().handleToolCall('legis_states', {});
    expect(res.content[0].text).toContain('| BUND |');
    expect(res.content[0].text).toContain('gesetze-bayern.de');
  });

  it('errors on an unknown tool and an unsupported state', async () => {
    const p = provider();
    expect((await p.handleToolCall('legis_bogus', {})).isError).toBe(true);
    await expect(p.handleToolCall('legis_search', { query: 'q', state: 'ZZ' }))
      .rejects.toThrow(/not yet supported/i);
  });

  it('shuts down cleanly', async () => {
    await expect(provider().shutdown()).resolves.toBeUndefined();
  });
});
