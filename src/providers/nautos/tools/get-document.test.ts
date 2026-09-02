import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleGetDocument } from './get-document.js';
import type { NautosClient, DocumentDetail, TocSection } from '../client.js';

let seq = 0;
const acCode = (): string => `AC-${process.pid}-${++seq}`;

const TOC: TocSection[] = [
  { id: 'sub-1', label: '1', title: 'Scope' },
  { id: 'sub-2', title: 'Terms', section: [{ id: 'sub-2.1', title: 'Definitions' }] },
];

function detail(din21Id: string | undefined = 'D1'): DocumentDetail {
  return {
    acCode: 'X', documentNumber: 'DIN 12345', titleDe: 'Norm Titel', titleEn: 'Norm Title',
    dateOfIssue: '2020-01-01', valid: true, documentType: ['norm'], classificationIcs: ['13.040'],
    ...(din21Id === undefined ? {} : { din21Id }),
  };
}

function fakeClient(over: Partial<Record<keyof NautosClient, unknown>> = {}): NautosClient {
  return {
    getDetail: vi.fn(async () => detail()),
    getToc: vi.fn(async () => TOC),
    getSection: vi.fn(async (_d: string, id: string) => `<p>Body of ${id}</p>`),
    ...over,
  } as unknown as NautosClient;
}

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('nautos handleGetDocument', () => {
  it('fetches and renders an outline with the table of contents', async () => {
    const res = await handleGetDocument(fakeClient(), { acCode: acCode() });
    const text = res.content[0].text;
    expect(text).toContain('DIN 12345');
    expect(text).toContain('Inhaltsverzeichnis');
    expect(text).toContain('Scope [`sub-1`]');
    expect(text).toContain('Definitions [`sub-2.1`]'); // nested TOC rendered
  });

  it('fetches a section by id, converting and caching it', async () => {
    const client = fakeClient();
    const code = acCode();
    const res = await handleGetDocument(client, { acCode: code, section: 'sub-1' });
    expect(res.content[0].text).toContain('Body of sub-1');
    expect(client.getSection).toHaveBeenCalledWith('D1', 'sub-1');
  });

  it('reports a missing section as an error', async () => {
    const client = fakeClient({ getSection: vi.fn(async () => '') });
    const res = await handleGetDocument(client, { acCode: acCode(), section: 'sub-9' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not found');
  });

  it('saves the full document and then serves a heading search from cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nautos-doc-'));
    dirs.push(dir);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);
    const file = join(dir, 'norm.md');
    const client = fakeClient();
    const code = acCode();

    const saved = await handleGetDocument(client, { acCode: code, save_path: file });
    expect(saved.content[0].text).toMatch(/saved|gespeichert|→|wrote|sections/i);
    const onDisk = await readFile(file, 'utf-8');
    expect(onDisk).toContain('Body of sub-1');
    expect(onDisk).toContain('Body of sub-2.1');

    // Sections are now cached; a heading-style query extracts from them.
    const heading = await handleGetDocument(client, { acCode: code, section: 'Body of sub-2' });
    expect(heading.content[0].text).toContain('Body of sub-2');
  });

  it('errors when the document has no fulltext (no din21Id)', async () => {
    const noFulltext = { ...detail(), din21Id: undefined } as DocumentDetail;
    const client = fakeClient({ getDetail: vi.fn(async () => noFulltext) });
    await expect(handleGetDocument(client, { acCode: acCode() }))
      .rejects.toThrow(/No fulltext/i);
  });
});
