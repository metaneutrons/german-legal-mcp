import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { LegislationReference } from '../../contracts/legal-resource.js';
import { EulDataClient } from './data-client.js';
import { EulBotChallengeError, EulDocumentNotFoundError } from './errors.js';
import { EUL_DOCUMENT_POLICY } from './network-policy.js';
import { assertUrlAllowed } from '../../shared/network-policy.js';

function http() {
  return {
    get: vi.fn(async (url: string) => url.includes('sparql')
      ? {
          data: {
            results: {
              bindings: [{
                celex: { value: '32016R0679' },
                title: { value: 'Datenschutz-Grundverordnung' },
              }],
            },
          },
        }
      : { data: '<div id="document1"><p>Rechtstext mit genügend Inhalt für einen Test.</p></div>' }),
  } as unknown as Pick<AxiosInstance, 'get'>;
}

describe('EulDataClient', () => {
  it('normalizes Cellar searches and documents', async () => {
    const transport = http();
    const data = new EulDataClient(transport);
    const page = await data.search({ query: 'Datenschutz', limit: 4 });
    expect(page.results[0]).toMatchObject({
      resourceType: 'legislation',
      jurisdiction: 'EU',
      celex: '32016R0679',
      provenance: { providerId: 'eul', sourceId: 'eul:cellar' },
    });
    expect((await data.get(page.results[0]!)).content.value).toContain('Rechtstext');
    expect(transport.get).toHaveBeenCalledWith(
      'https://publications.europa.eu/resource/celex/32016R0679',
      expect.objectContaining({
        headers: {
          Accept: 'application/xhtml+xml, text/html;q=0.9',
          'Accept-Language': 'deu',
        },
        responseType: 'text',
      }),
    );
  });

  it('applies type, jurisdiction and source filters', async () => {
    const data = new EulDataClient(http());
    for (const request of [
      { query: 'x', resourceTypes: ['case-law'] as const },
      { query: 'x', jurisdictions: ['DE'] },
      { query: 'x', sourceIds: ['other'] },
    ]) {
      await expect(data.search(request)).resolves.toEqual({ results: [], failures: [] });
    }
    const wrong = {
      resourceType: 'legislation',
      title: 'x',
      provenance: { providerId: 'other', sourceId: 'eul:cellar', providerDocumentId: 'x' },
      rights: { access: 'public', fullTextStorage: 'allowed', redistribution: 'unknown' },
    } as LegislationReference;
    await expect(data.get(wrong)).rejects.toThrow('does not belong');
  });

  it('uses language and resource-type filters in SPARQL', async () => {
    const transport = http();
    const data = new EulDataClient(transport);
    await data.searchLegislation('"privacy"', {
      resourceType: 'regulation',
      language: 'EN',
      limit: 2,
    });
    const options = vi.mocked(transport.get).mock.calls[0]?.[1] as { params: { query: string } };
    expect(options.params.query).toContain('resource-type/REG');
    expect(options.params.query).toContain('language/ENG');
    expect(options.params.query).toContain('LIMIT 2');
  });
});

describe('EulDataClient enumeration', () => {
  function sparqlHttp(rows: Record<string, { value: string }>[]) {
    return {
      get: vi.fn(async () => ({ data: { results: { bindings: rows } } })),
    } as unknown as Pick<AxiosInstance, 'get'> & { get: ReturnType<typeof vi.fn> };
  }

  const row = (celex: string, date = '2026-07-01') => ({
    celex: { value: celex },
    title: { value: `Titel ${celex}` },
    date: { value: date },
  });

  it('filters server-side and reports native origin', async () => {
    const http = sparqlHttp([row('32016R0679')]);
    const page = await new EulDataClient(http).enumerate({ since: '2026-07-01' });

    expect(page.origin).toBe('native');
    const query = http.get.mock.calls[0]?.[1]?.params?.query as string;
    expect(query).toContain('FILTER(?date >= "2026-07-01"^^xsd:date)');
    expect(query).toContain('ORDER BY ?celex');
    expect(page.results[0]).toMatchObject({
      resourceType: 'legislation',
      jurisdiction: 'EU',
      celex: '32016R0679',
      publicationDate: '2026-07-01',
      provenance: expect.objectContaining({ providerDocumentId: '32016R0679' }),
    });
  });

  it('pages on CELEX rather than OFFSET, which a live store would shift', async () => {
    const http = sparqlHttp([row('32016R0679'), row('32019R0881')]);
    const page = await new EulDataClient(http).enumerate({ limit: 2 });
    expect(page.nextCursor).toBe('32019R0881');

    const resumed = sparqlHttp([row('32022R2065')]);
    await new EulDataClient(resumed).enumerate({ limit: 2, cursor: page.nextCursor as string });
    const query = resumed.get.mock.calls[0]?.[1]?.params?.query as string;
    expect(query).toContain('FILTER(STR(?celex) > "32019R0881")');
  });

  it('stops when a page comes back short', async () => {
    const http = sparqlHttp([row('32016R0679')]);
    const page = await new EulDataClient(http).enumerate({ limit: 5 });
    expect(page.nextCursor).toBeUndefined();
  });
});

describe('EulDataClient Cellar documents', () => {
  const MANIFESTATION = 'publications.europa.eu/resource/cellar/dc8116a1-3fe6-11ef-865a-01aa75ed71a1.0004.03/DOC_1';
  const DOCUMENT = '<p class="oj-ti-art">Artikel 1</p><p>Gegenstand der Verordnung mit genügend Text.</p>';

  function cellar(final: { status: number; data?: string; headers?: Record<string, string> }) {
    return {
      get: vi.fn(async (url: string) => (url.includes('/resource/celex/')
        ? { status: 303, data: '', headers: { location: `http://${MANIFESTATION}` } }
        : { headers: {}, data: '', ...final })),
    } as unknown as Pick<AxiosInstance, 'get'> & { get: ReturnType<typeof vi.fn> };
  }

  it('follows the 303 to the manifestation over HTTPS, never over http', async () => {
    const transport = cellar({ status: 200, data: DOCUMENT });
    const text = await new EulDataClient(transport).getLegislationText('32024R1689', 'en');

    expect(transport.get.mock.calls.map(([url]) => url)).toEqual([
      'https://publications.europa.eu/resource/celex/32024R1689',
      `https://${MANIFESTATION}`,
    ]);
    expect(transport.get.mock.calls[0]?.[1]?.headers).toMatchObject({ 'Accept-Language': 'eng' });
    expect(text).toMatchObject({ celex: '32024R1689', language: 'EN', version: 'official-journal' });
    expect(text.markdown).toContain('## Artikel 1');
  });

  it('refuses a redirect off the Cellar manifestation paths', async () => {
    const transport = {
      get: vi.fn(async () => ({
        status: 303,
        data: '',
        headers: { location: 'http://publications.europa.eu/other/DOC_1' },
      })),
    } as unknown as Pick<AxiosInstance, 'get'>;
    await expect(new EulDataClient(transport).getLegislation('32024R1689'))
      .rejects.toThrow(/requires HTTPS/);
  });

  it('reports an AWS WAF challenge instead of returning it as a document', async () => {
    await expect(new EulDataClient(cellar({
      status: 202,
      data: '<html><script>window.awsWafCookieDomainList = [];</script></html>',
      headers: { 'x-amzn-waf-action': 'challenge' },
    })).getLegislation('32024R1689')).rejects.toBeInstanceOf(EulBotChallengeError);

    // Also when an intermediary dropped the header but the page is the challenge.
    await expect(new EulDataClient(cellar({
      status: 200,
      data: '<script src="https://abc.edge.token.awswaf.com/abc/challenge.js"></script>',
    })).getLegislation('32024R1689')).rejects.toBeInstanceOf(EulBotChallengeError);
  });

  it('distinguishes a missing manifestation from other non-200 answers', async () => {
    await expect(new EulDataClient(cellar({ status: 404 })).getLegislation('32024R1689', 'GA'))
      .rejects.toBeInstanceOf(EulDocumentNotFoundError);
    await expect(new EulDataClient(cellar({ status: 202, data: DOCUMENT })).getLegislation('32024R1689'))
      .rejects.toThrow(/HTTP 202/);
  });

  it('rejects languages Cellar does not publish in', async () => {
    await expect(new EulDataClient(cellar({ status: 200, data: DOCUMENT })).getLegislation('32024R1689', 'XX'))
      .rejects.toThrow(/Invalid EUR-Lex language/);
  });

  it('labels a dated consolidated CELEX as a consolidated version', async () => {
    const text = await new EulDataClient(cellar({ status: 200, data: DOCUMENT }))
      .getLegislationText('02024R1689-20240712');
    expect(text).toMatchObject({ version: 'consolidated', consolidationDate: '2024-07-12' });
  });

  it('resolves a bare consolidated CELEX to the newest version already in force', async () => {
    const transport = {
      get: vi.fn(async (url: string) => {
        if (url.includes('sparql')) {
          return {
            data: {
              results: {
                // The relation also yields consolidations of acts the AI Act amends.
                bindings: ['02024R1689-20240712', '02020L1828-20260802', '02024R1689-29991231', '02024R1689-20260727']
                  .map((value) => ({ celex: { value } })),
              },
            },
          };
        }
        if (url.includes('/resource/celex/')) {
          return { status: 303, data: '', headers: { location: `http://${MANIFESTATION}` } };
        }
        return { status: 200, headers: {}, data: DOCUMENT };
      }),
    } as unknown as Pick<AxiosInstance, 'get'> & { get: ReturnType<typeof vi.fn> };

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    const text = await new EulDataClient(transport).getLegislationText('02024r1689')
      .finally(() => vi.useRealTimers());

    const query = transport.get.mock.calls[0]?.[1]?.params?.query as string;
    expect(query).toContain('"32024R1689"^^xsd:string');
    expect(query).toContain('cdm:act_consolidated_consolidates_resource_legal');
    expect(transport.get.mock.calls[1]?.[0]).toBe('https://publications.europa.eu/resource/celex/02024R1689-20260727');
    expect(text).toMatchObject({
      celex: '02024R1689-20260727',
      version: 'consolidated',
      consolidationDate: '2026-07-27',
      otherVersions: ['02024R1689-29991231', '02024R1689-20240712'],
    });
  });

  it('falls back to a prefix scan, then reports a base without any version as not found', async () => {
    const transport = {
      get: vi.fn(async () => ({ data: { results: { bindings: [] } } })),
    } as unknown as Pick<AxiosInstance, 'get'> & { get: ReturnType<typeof vi.fn> };
    await expect(new EulDataClient(transport).getLegislation('02099R9999'))
      .rejects.toBeInstanceOf(EulDocumentNotFoundError);
    expect(transport.get).toHaveBeenCalledTimes(2);
    expect(transport.get.mock.calls[1]?.[1]?.params?.query).toContain('STRSTARTS(STR(?celex), "02099R9999-")');
  });
});

describe('EUL document network policy', () => {
  it('allows exactly the Cellar CELEX and manifestation paths over HTTPS', () => {
    for (const url of [
      'https://publications.europa.eu/resource/celex/32024R1689',
      'https://publications.europa.eu/resource/celex/02024R1689-20260727',
      'https://publications.europa.eu/resource/cellar/dc8116a1-3fe6-11ef-865a-01aa75ed71a1.0004.03/DOC_1',
    ]) {
      expect(() => assertUrlAllowed(url, EUL_DOCUMENT_POLICY)).not.toThrow();
    }
    for (const url of [
      'http://publications.europa.eu/resource/cellar/dc8116a1-3fe6-11ef-865a-01aa75ed71a1.0004.03/DOC_1',
      'https://publications.europa.eu/resource/cellar/dc8116a1-3fe6-11ef-865a-01aa75ed71a1.0004.03/DOC_1/../x',
      'https://publications.europa.eu/resource/cellar/dc8116a1-3fe6-11ef-865a-01aa75ed71a1/rdf',
      'https://publications.europa.eu/webapi/rdf/sparql',
      'https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/',
    ]) {
      expect(() => assertUrlAllowed(url, EUL_DOCUMENT_POLICY)).toThrow();
    }
  });
});
