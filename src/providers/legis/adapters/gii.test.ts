import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockAxios, giiGetLegislation } = vi.hoisted(() => ({
  mockAxios: { get: vi.fn(), post: vi.fn() },
  giiGetLegislation: vi.fn(),
}));

vi.mock('axios', () => ({ default: mockAxios }));
vi.mock('../../../shared/clients/gii.js', () => ({ giiGetLegislation }));

import { GiiAdapter } from './gii.js';

beforeEach(() => {
  mockAxios.get.mockReset();
  giiGetLegislation.mockReset();
});

describe('GiiAdapter', () => {
  it('does not support search', async () => {
    await expect(new GiiAdapter().search('BUND', 'x', 10)).rejects.toThrow(/does not support search/i);
  });

  it('treats a known bare slug as the whole law rather than an error', async () => {
    // Previously this threw "BUND id must be law/section". Enumeration yields
    // laws, and a reference that cannot be fetched would break the walk-then-
    // fetch contract every other provider honours, so a known slug now
    // resolves to the law's index page. `slug/section` is unchanged.
    const { readFile } = await import('node:fs/promises');
    const toc = await readFile(new URL('./fixtures/gii-toc.xml', import.meta.url), 'utf8');
    mockAxios.get.mockImplementation(async (url: string) => url.includes('gii-toc.xml')
      ? { data: toc }
      : { data: Buffer.from('<html><head><title>BGB</title></head><body></body></html>', 'latin1') });

    const entry = await new GiiAdapter().get('BUND', 'bgb');
    expect(entry.url).toBe('https://www.gesetze-im-internet.de/bgb/index.html');
    expect(giiGetLegislation).not.toHaveBeenCalled();
  });

  it('still catches a missing separator, and says what was meant', async () => {
    const { readFile } = await import('node:fs/promises');
    const toc = await readFile(new URL('./fixtures/gii-toc.xml', import.meta.url), 'utf8');
    mockAxios.get.mockResolvedValue({ data: toc });

    // The whole point of validating against the index: `bgb823` and `uwg_2004`
    // are indistinguishable as strings, and only the index knows which is real.
    await expect(new GiiAdapter().get('BUND', 'bgb823')).rejects.toThrow(/law\/section/);
    await expect(new GiiAdapter().get('BUND', 'bgb823')).rejects.toThrow(/Did you mean "bgb\/823"/);
  });

  it('delegates get to the GII legislation client', async () => {
    giiGetLegislation.mockResolvedValue({ title: 'BGB § 823', content: 'Body', url: 'http://x' });
    const entry = await new GiiAdapter().get('BUND', 'bgb/823');
    expect(giiGetLegislation).toHaveBeenCalledWith('bgb', '823');
    expect(entry).toEqual({ title: 'BGB § 823', content: 'Body', url: 'http://x' });
  });

  it('parses the index page into a table of contents', async () => {
    const html = '<div id="paddingLR12">'
      + '<a href="/bgb/__1.html">§ 1 Beginn der Rechtsfähigkeit</a>'
      + '<a href="/bgb/__2.html">§ 2 Eintritt der Volljährigkeit</a>'
      + '</div>';
    mockAxios.get.mockResolvedValue({ data: Buffer.from(html, 'latin1') });

    const toc = await new GiiAdapter().toc('BUND', 'bgb');
    expect(toc.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GiiAdapter enumeration', () => {
  beforeEach(() => { mockAxios.get.mockReset(); });

  async function tocXml(): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    return readFile(new URL('./fixtures/gii-toc.xml', import.meta.url), 'utf8');
  }

  it('walks the law index, sorted by slug and entity-decoded', async () => {
    mockAxios.get.mockResolvedValue({ data: await tocXml() });
    const page = await new GiiAdapter().enumerate('BUND');

    // No date anywhere in the feed, so no bound can be honoured.
    expect(page.origin).toBe('unfiltered');
    expect(page.results.map((r) => r.id)).toEqual(['1-dm-goldm_nzg', 'bgb', 'gg', 'uwg_2004']);
    expect(page.results[0]?.title).toContain('Stiftung "Geld und Währung"');
    expect(page.results[1]).toMatchObject({
      title: 'Bürgerliches Gesetzbuch',
      url: 'https://www.gesetze-im-internet.de/bgb/index.html',
    });
  });

  it('reports unfiltered even when a since bound is supplied', async () => {
    mockAxios.get.mockResolvedValue({ data: await tocXml() });
    const page = await new GiiAdapter().enumerate('BUND', { since: '2026-08-01' });
    // Silently filtering nothing while claiming a delta is the failure this
    // value exists to prevent.
    expect(page.origin).toBe('unfiltered');
    expect(page.results).toHaveLength(4);
  });

  it('pages by last slug emitted and downloads the index once', async () => {
    mockAxios.get.mockResolvedValue({ data: await tocXml() });
    const adapter = new GiiAdapter();
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await adapter.enumerate('BUND', { limit: 3, ...(cursor ? { cursor } : {}) });
      seen.push(...page.results.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual(['1-dm-goldm_nzg', 'bgb', 'gg', 'uwg_2004']);
    expect(mockAxios.get).toHaveBeenCalledTimes(1);
  });

  it('renders the law index as the whole-law document', async () => {
    const { readFile } = await import('node:fs/promises');
    const toc = await readFile(new URL('./fixtures/gii-toc.xml', import.meta.url), 'utf8');
    const index = '<html><head><title>BGB</title></head><body><div id="paddingLR12">'
      + '<a href="__823.html">§ 823 Schadensersatzpflicht</a>'
      + '<a href="__826.html">§ 826 Sittenwidrige vorsätzliche Schädigung</a>'
      + '</div></body></html>';
    mockAxios.get.mockImplementation(async (url: string) => url.includes('gii-toc.xml')
      ? { data: toc }
      : { data: Buffer.from(index, 'latin1') });

    const entry = await new GiiAdapter().get('BUND', 'bgb');
    expect(entry.content).toContain('§ 823');
    expect(entry.content).toContain('§ 826');
    // The section texts themselves still come from "slug/section".
    expect(giiGetLegislation).not.toHaveBeenCalled();
  });

  it('falls back to demanding law/section when the index is unreachable', async () => {
    mockAxios.get.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(new GiiAdapter().get('BUND', 'bgb')).rejects.toThrow(/law\/section/);
  });
});
