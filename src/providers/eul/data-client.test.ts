import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { LegislationReference } from '../../contracts/legal-resource.js';
import { EulDataClient } from './data-client.js';

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
      expect.stringContaining('/legal-content/DE/TXT/HTML/'),
      expect.objectContaining({
        params: { uri: 'CELEX:32016R0679' },
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
