import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isAxiosError: (e: any) => e?.isAxiosError === true,
  },
}));

vi.mock('../save-to-file.js', () => ({
  saveToFile: vi.fn(async (path: string, content: string, meta?: string) => ({
    content: [{
      type: 'text',
      text: `Saved to ${path} (${content.length} chars)${meta ? `\n\n${meta}` : ''}`,
    }],
  })),
}));

import axios from 'axios';
const mockGet = vi.mocked(axios.get);
const mockPost = vi.mocked(axios.post);

// --- GII Client Tests ---

describe('giiGetLegislation', () => {
  beforeEach(() => vi.clearAllMocks());

  async function getGii() {
    const mod = await import('./gii.js');
    return mod.giiGetLegislation;
  }

  it('should fetch and parse legislation', async () => {
    const giiGetLegislation = await getGii();
    mockGet.mockResolvedValueOnce({
      data: Buffer.from(
        '<html><body>' +
        '<div class="jnheader"><h1>Bürgerliches Gesetzbuch (BGB)</h1></div>' +
        '<span class="jnenbez">§ 823</span>' +
        '<span class="jnentitel">Schadensersatzpflicht</span>' +
        '<div class="jnhtml"><p>(1) Wer vorsätzlich...</p></div>' +
        '</body></html>',
        'latin1',
      ),
    } as any);

    const result = await giiGetLegislation('BGB', '823');
    expect(result.title).toContain('BGB');
    expect(result.title).toContain('§ 823');
    expect(result.content).toContain('vorsätzlich');
    expect(result.url).toBe('https://www.gesetze-im-internet.de/bgb/__823.html');
  });

  it('should strip § prefix from section', async () => {
    const giiGetLegislation = await getGii();
    mockGet.mockResolvedValueOnce({ data: Buffer.from('<html><body><div class="jnhtml"></div></body></html>', 'latin1') } as any);

    await giiGetLegislation('BGB', '§ 823');
    expect(mockGet).toHaveBeenCalledWith(
      'https://www.gesetze-im-internet.de/bgb/__823.html',
      expect.any(Object),
    );
  });

  it('should strip Art. prefix from section', async () => {
    const giiGetLegislation = await getGii();
    mockGet.mockResolvedValueOnce({ data: Buffer.from('<html><body><div class="jnhtml"></div></body></html>', 'latin1') } as any);

    await giiGetLegislation('GG', 'Art. 1');
    expect(mockGet).toHaveBeenCalledWith(
      'https://www.gesetze-im-internet.de/gg/__1.html',
      expect.any(Object),
    );
  });

  it('should throw on 404', async () => {
    const giiGetLegislation = await getGii();
    const error: any = new Error('Not Found');
    error.isAxiosError = true;
    error.response = { status: 404 };
    mockGet.mockRejectedValueOnce(error);

    await expect(giiGetLegislation('BGB', '99999')).rejects.toThrow('Legislation not found');
  });

  it('points to a subscription-provider fallback on 404', async () => {
    const giiGetLegislation = await getGii();
    const error: any = new Error('Not Found');
    error.isAxiosError = true;
    error.response = { status: 404 };
    mockGet.mockRejectedValueOnce(error);

    // Deliberately provider-agnostic: naming the private provider here would
    // leak it into the public distribution, which ships this client and test.
    await expect(giiGetLegislation('BGB', '99999'))
      .rejects.toThrow('subscription provider');
  });

  it('resolves BtMG through its aliased gesetze-im-internet.de slug', async () => {
    const giiGetLegislation = await getGii();
    mockGet.mockResolvedValueOnce({
      data: Buffer.from('<html><body><div class="jnhtml"></div></body></html>', 'latin1'),
    } as any);

    await giiGetLegislation('btmg', '29');
    expect(mockGet).toHaveBeenCalledWith(
      'https://www.gesetze-im-internet.de/btmg_1981/__29.html',
      expect.any(Object),
    );
  });
});

// --- jportal Client Tests ---

describe('jportal client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module to clear session cache
    vi.resetModules();
  });

  function mockInitResponse(portalId: string) {
    mockPost.mockResolvedValueOnce({
      data: {
        user: { login: `Buergerservice${portalId}` },
        csrfToken: 'test-csrf-token',
        searchConfig: {},
      },
      headers: {
        'set-cookie': [`JSESSIONID=test-session-id; Path=/; Secure`],
      },
    } as any);
  }

  async function getJportal() {
    return import('./jportal.js');
  }

  it('should initialize session and search', async () => {
    const { jportalSearch } = await getJportal();
    mockInitResponse('bsbw');
    mockPost.mockResolvedValueOnce({
      data: {
        resultList: [
          {
            docId: 'jlr-TestDoc',
            titleList: ['§ 1 TestG'],
            subtitleList: ['Landesnorm BW', 'Testgesetz'],
            categoryId: 'Gesetze',
            date: '01.01.2026',
            docPart: 'S',
          },
        ],
      },
    } as any);

    const results = await jportalSearch('BW', 'Test', 10);
    expect(results).toHaveLength(1);
    expect(results[0].docId).toBe('jlr-TestDoc');
    expect(results[0].title).toBe('§ 1 TestG');

    // Verify init was called with correct headers
    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/init'),
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          'JURIS-PORTALID': 'bsbw',
          Cookie: 'r3autologin="bsbw"',
        }),
      }),
    );
  });

  it('should search with the configured FastSearch field', async () => {
    const { jportalSearch } = await getJportal();
    mockInitResponse('bsbw');
    mockPost.mockResolvedValueOnce({ data: { hits: 0 } } as any);

    await expect(jportalSearch('BW', 'Kammergesetz Heilberufe', 10)).resolves.toEqual([]);
    expect(mockPost).toHaveBeenLastCalledWith(
      expect.stringContaining('/search'),
      expect.objectContaining({
        searches: [{ id: 'FastSearch', value: 'Kammergesetz Heilberufe' }],
      }),
      expect.any(Object),
    );
  });

  it('should propagate search 404 because no hits are reported as HTTP 200', async () => {
    const { jportalSearch } = await getJportal();
    mockInitResponse('bsbw');
    const error: any = new Error('Request failed with status code 404');
    error.isAxiosError = true;
    error.response = { status: 404 };
    mockPost.mockRejectedValueOnce(error);

    await expect(jportalSearch('BW', 'Kammergesetz Heilberufe', 10)).rejects.toThrow('404');
  });

  it('should fetch document', async () => {
    const { jportalGetDocument } = await getJportal();
    mockInitResponse('bsbw');
    mockPost.mockResolvedValueOnce({
      data: {
        documentTitle: { title: '§ 10 GemO' },
        head: '<div>Header</div>',
        text: '<p>Einwohner der Gemeinde ist...</p>',
        permalink: 'https://www.landesrecht-bw.de/perma?d=test',
      },
    } as any);

    const doc = await jportalGetDocument('BW', 'jlr-TestDoc');
    expect(doc.title).toBe('§ 10 GemO');
    expect(doc.text).toContain('Einwohner');
    expect(doc.permalink).toContain('landesrecht-bw.de');
  });

  it('should retry on session expiry', async () => {
    const { jportalSearch } = await getJportal();
    // First init
    mockInitResponse('bsbw');
    // First search fails with notAuthenticated
    const authError: any = new Error('Not authenticated');
    authError.isAxiosError = true;
    authError.response = { data: { msgId: 'security_notAuthenticated' } };
    mockPost.mockRejectedValueOnce(authError);
    // Re-init
    mockInitResponse('bsbw');
    // Retry search succeeds
    mockPost.mockResolvedValueOnce({ data: { resultList: [] } } as any);

    const results = await jportalSearch('BW', 'Test', 5);
    expect(results).toHaveLength(0);
    // init (1) + failed search (2) + re-init (3) + retry search (4)
    expect(mockPost).toHaveBeenCalledTimes(4);
  });

  it('should throw for unsupported state', async () => {
    const { jportalSearch } = await getJportal();
    await expect(jportalSearch('XX', 'Test', 5)).rejects.toThrow('No jportal config');
  });
});

// --- Legis Provider Tests ---

describe('LegisProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  async function getProvider() {
    const mod = await import('../../providers/legis/index.js');
    return mod.createProvider()!;
  }

  it('should register four tools', async () => {
    const provider = await getProvider();
    const tools = provider.getTools();
    expect(tools.map((t: any) => t.name)).toEqual(['legis_search', 'legis_get', 'legis_toc', 'legis_states']);
  });

  it('should return error for unknown tool', async () => {
    const provider = await getProvider();
    const result = await provider.handleToolCall('legis_unknown', {});
    expect(result.isError).toBe(true);
  });

  it('should handle legis_states', async () => {
    const provider = await getProvider();
    const result = await provider.handleToolCall('legis_states', {});
    expect(result.content[0].text).toContain('BUND');
    expect(result.content[0].text).toContain('BW');
    expect(result.content[0].text).toContain('Available');
  });

  it('should handle legis_get for BUND', async () => {
    const provider = await getProvider();
    mockGet.mockResolvedValueOnce({
      data: Buffer.from(
        '<html><body>' +
        '<div class="jnheader"><h1>BGB</h1></div>' +
        '<span class="jnenbez">§ 1</span><span class="jnentitel">Test</span>' +
        '<div class="jnhtml"><p>Wer vorsätzlich oder fahrlässig das Leben, den Körper, die Gesundheit oder die Freiheit verletzt.</p></div>' +
        '</body></html>',
        'latin1',
      ),
    } as any);

    const result = await provider.handleToolCall('legis_get', { id: 'bgb/1', state: 'BUND' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('vorsätzlich');
  });

  it('should reject BUND search', async () => {
    const provider = await getProvider();
    await expect(provider.handleToolCall('legis_search', { query: 'test', state: 'BUND' })).rejects.toThrow('does not support search');
  });

  it('should reject invalid BUND id format', async () => {
    const provider = await getProvider();
    await expect(provider.handleToolCall('legis_get', { id: 'bgb823', state: 'BUND' })).rejects.toThrow('law/section');
  });

  it('should handle NI search', async () => {
    const provider = await getProvider();
    mockGet.mockResolvedValueOnce({
      data: '<html><h3><a href="/browse/document/abc-123">§ 1 NPOG</a></h3></html>',
    } as any);

    const result = await provider.handleToolCall('legis_search', { query: 'NPOG', state: 'NI', limit: 3 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('§ 1 NPOG');
    expect(result.content[0].text).toContain('abc-123');
  });

  it('should handle NI get', async () => {
    const provider = await getProvider();
    mockGet.mockResolvedValueOnce({
      data: '<html><title>§ 1 NPOG | NI-VORIS</title><div class="wkde-document-body"><p>Aufgaben der Polizei</p></div></html>',
    } as any);

    const result = await provider.handleToolCall('legis_get', { id: 'abc-123', state: 'NI' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Aufgaben der Polizei');
  });

  it('should reject unsupported state', async () => {
    const provider = await getProvider();
    await expect(provider.handleToolCall('legis_get', { id: 'test', state: 'XX' })).rejects.toThrow('not yet supported');
  });

  it('should save to file with save_path', async () => {
    const provider = await getProvider();
    mockGet.mockResolvedValueOnce({
      data: Buffer.from(
        '<html><body><div class="jnheader"><h1>GG</h1></div>' +
        '<span class="jnenbez">Art 1</span><span class="jnentitel">Würde</span>' +
        '<div class="jnhtml"><p>Die Würde des Menschen</p></div></body></html>',
        'latin1',
      ),
    } as any);

    const result = await provider.handleToolCall('legis_get', {
      id: 'gg/Art. 1', state: 'BUND', save_path: '/tmp/test.md',
    });
    expect(result.content[0].text).toContain('Saved to /tmp/test.md');
  });

  it('should be disabled via env var', async () => {
    process.env.GLMCP_LEGIS_ENABLED = 'false';
    const mod = await import('../../providers/legis/index.js');
    expect(mod.createProvider()).toBeNull();
    delete process.env.GLMCP_LEGIS_ENABLED;
  });
});
