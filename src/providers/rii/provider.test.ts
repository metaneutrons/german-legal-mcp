import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { RiiConverter } from './converter.js';
import { RiiProvider } from './provider.js';
import type { DecisionAdapter } from './types.js';

function http() {
  return {
    get: vi.fn(async (_url: string, options?: { params?: Record<string, string> }) => {
      if (options?.params?.['doc.id']) {
        return {
          data: '<div class="docLayoutTitel">Title</div>' +
            '<table><tr><td><strong>Gericht:</strong></td><td>BGH</td></tr>' +
            '<tr><td><strong>Aktenzeichen:</strong></td><td>I ZR 1/25</td></tr></table>' +
            '<div class="docLayoutText"><p>Decision text with enough meaningful ' +
            'legal content to satisfy conversion validation. This synthetic fixture ' +
            'describes a complete holding and its supporting reasons.</p></div>',
        };
      }
      return {
        data: '<a class="TrefferlisteHervorheben" id="tlid1" ' +
          'href="?doc.id=case-1" title="Decision">Decision</a>',
      };
    }),
  } as unknown as Pick<AxiosInstance, 'get'>;
}

describe('RiiProvider', () => {
  it('searches and retrieves federal decisions through injected HTTP', async () => {
    const provider = new RiiProvider(http(), new RiiConverter());
    await expect(provider.handleToolCall('rii_search', {
      query: 'copyright',
      source: 'BUND',
    })).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('case-1') }],
    });
    await expect(provider.handleToolCall('rii_get_decision', {
      doc_id: 'case-1',
      source: 'BUND',
    })).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('Decision text') }],
    });
    await expect(provider.handleToolCall('rii_unknown', {}))
      .resolves.toMatchObject({ isError: true });
  });

  it.each([
    ['NW', 'http://nrwe.justiz.nrw.de/example.html'],
    ['NW', 'https://127.0.0.1/internal.html'],
    ['NW', 'https://169.254.169.254/latest/meta-data/'],
    ['NW', 'https://user:secret@nrwe.justiz.nrw.de/example.html'],
    ['HB', 'https://www.verwaltungsgericht.bremen.de/entscheidungen/%2e%2e/private'],
    ['BUND', '../private'],
  ])('rejects unsafe %s document id %s before adapter dispatch', async (source, doc_id) => {
    const get = vi.fn();
    const adapter: DecisionAdapter = { sources: [source], search: vi.fn(), get };
    const provider = new RiiProvider(http(), new RiiConverter(), [adapter]);

    await expect(provider.handleToolCall('rii_get_decision', { source, doc_id }))
      .rejects.toThrow(/network policy|opaque identifier/);
    expect(get).not.toHaveBeenCalled();
  });

  it('consolidates ALL sources in parallel, deduplicates, and isolates portal failures', async () => {
    const adapters: DecisionAdapter[] = [
      { sources: ['BUND'], search: async () => [{ id: 'same', title: 'VwVfG Entscheidung', subtitle: 'Bund', date: '2024', court: 'VG', fileNumber: '1 A 1/24' }], get: vi.fn() },
      { sources: ['NW'], search: async () => [{ id: 'nw-1', title: 'VwVfG NRW', subtitle: 'NRWE', date: '2023' }], get: vi.fn() },
      { sources: ['BY'], search: async () => { throw new Error('portal unavailable'); }, get: vi.fn() },
      { sources: ['SH'], search: async () => [{ id: 'same', title: 'VwVfG Entscheidung', subtitle: 'SH', date: '2024', court: 'VG', fileNumber: '1 A 1/24' }], get: vi.fn() },
    ];
    const provider = new RiiProvider(http(), new RiiConverter(), adapters);
    const search = await provider.handleToolCall('rii_search', { query: 'VwVfG', source: 'ALL', limit: 10 });
    const text = (search.content[0] as { text: string }).text;
    const rows = text.split('\n').slice(text.split('\n').indexOf('src\tdate\tcourt\taz\tecli\ttitle\tdocId') + 1);

    // SH returns the same court+fileNumber as BUND and must be deduplicated away.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.split('\t')[0])).toEqual(['BUND', 'NW']);
    // The unreachable portal is named rather than merely counted.
    expect(text).toContain('1 portal(s) unavailable: BY');
    expect(text).toContain('2 of 4 portals: BUND 1 · NW 1');

    await expect(provider.handleToolCall('rii_get_decision', { doc_id: 'same', source: 'ALL' })).resolves.toMatchObject({ isError: true });
  });

  it('asks each portal for its own page and names the ones that cannot page', async () => {
    const pageable: DecisionAdapter = {
      sources: ['BW'],
      search: async () => [],
      searchPage: async (_source, _query, _limit, page = 1) => ({
        results: [{ id: `bw-p${page}`, title: `page ${page}`, subtitle: '', date: '01.01.2026' }],
        totalHits: 903,
      }),
      get: vi.fn(),
    };
    // No searchPage at all: the client must not re-run its page-1 search.
    const unpageable: DecisionAdapter = {
      sources: ['HB'],
      search: async () => [{ id: 'hb-1', title: 'Bremen only page', subtitle: '', date: '01.01.2026' }],
      get: vi.fn(),
    };
    const provider = new RiiProvider(http(), new RiiConverter(), [pageable, unpageable]);

    const first = (await provider.handleToolCall('rii_search', { query: 'x', source: 'ALL', limit: 5 })
      .then((r) => (r.content[0] as { text: string }).text));
    expect(first).toContain('bw-p1');
    expect(first).toContain('hb-1');
    expect(first).not.toContain('cannot page');

    const second = (await provider.handleToolCall('rii_search', { query: 'x', source: 'ALL', limit: 5, page: 2 })
      .then((r) => (r.content[0] as { text: string }).text));
    expect(second).toContain('bw-p2');
    // Bremen's single page must not reappear on page 2.
    expect(second).not.toContain('hb-1');
    expect(second).toContain('No page 2 available from: HB');
  });

  it('shares the page across portals instead of letting the first-registered one fill it', async () => {
    // A single-term query scores every hit identically, so before the fair
    // allocation the stable sort handed all ten slots to the first adapter.
    // Each source's dates are disjoint and BUND's are the newest, so ranking
    // alone would still hand every slot to BUND — this isolates the allocation
    // from the date tie-break rather than letting the tie-break mask it.
    const flood = (source: string, decade: number): DecisionAdapter => ({
      sources: [source],
      search: async () => Array.from({ length: 25 }, (_, index) => ({
        id: `${source}-${index}`,
        title: `Schadensersatz ${source} ${index}`,
        subtitle: '',
        date: `01.01.${decade + (24 - index)}`,
      })),
      get: vi.fn(),
    });
    const provider = new RiiProvider(http(), new RiiConverter(), [
      flood('BUND', 2000), flood('NW', 1970), flood('BY', 1940),
    ]);

    // collapse_duplicates off: these fixtures differ only in a trailing number,
    // so clustering would legitimately fold them and mask what is under test.
    const result = await provider.handleToolCall('rii_search', {
      query: 'Schadensersatz', source: 'ALL', limit: 9, collapse_duplicates: false,
    });
    const text = (result.content[0] as { text: string }).text;
    const sources = text.split('\n')
      .slice(text.split('\n').indexOf('src\tdate\tcourt\taz\tecli\ttitle\tdocId') + 1)
      .map((row) => row.split('\t')[0]);

    expect(sources).toHaveLength(9);
    // Three each, not nine from BUND.
    for (const source of ['BUND', 'NW', 'BY']) {
      expect(sources.filter((value) => value === source)).toHaveLength(3);
    }
  });

  it('scores the court and file number, not just the free text', async () => {
    // Both hits match "Kündigung"; only one is a labour court. The adapter
    // resolves the court into its own field rather than into the title, which
    // is exactly the case where the court name used to be invisible to scoring.
    const adapter: DecisionAdapter = {
      sources: ['HH'],
      search: async () => [
        {
          id: 'civil', title: 'Kündigung eines Mietvertrags', subtitle: '',
          date: '01.01.2026', court: 'Amtsgericht Hamburg', fileNumber: '12 C 5/25',
        },
        {
          id: 'labour', title: 'Kündigung nach Datenlöschung', subtitle: '',
          date: '01.01.2020', court: 'Landesarbeitsgericht Hamburg', fileNumber: '5 Sa 12/22',
        },
      ],
      get: vi.fn(),
    };
    const provider = new RiiProvider(http(), new RiiConverter(), [adapter]);

    const text = await provider
      .handleToolCall('rii_search', { query: 'Landesarbeitsgericht Kündigung', source: 'ALL', limit: 2 })
      .then((r) => (r.content[0] as { text: string }).text);
    const rows = text.split('\n');
    const header = rows.indexOf('src\tdate\tcourt\taz\tecli\ttitle\tdocId');

    // Two of two terms match the labour hit against one of two for the civil
    // one, so it must rank first — despite being the older of the pair, which
    // is what the date tie-break would otherwise decide.
    expect(rows[header + 1]).toContain('labour');
  });
});
