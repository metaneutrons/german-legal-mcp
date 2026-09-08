import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { CaseLawReference } from '../../contracts/legal-resource.js';
import { celexCandidates, createSearchPayload, IcuDataClient } from './data-client.js';

const content = {
  docType: 'Urteil',
  docDate: '2026-01-01',
  idPublished: 'C-1/26',
  ecli: 'ECLI:EU:C:2026:1',
  celex: '62026CJ0001',
  affairJurisdiction: 'Gerichtshof',
  logicDocId: 'id_123',
};

function http(searchHits = [{ content }]) {
  return {
    post: vi.fn(async () => ({ data: { totalHits: searchHits.length, searchHits } })),
    get: vi.fn(async () => ({
      data: '<P><A NAME="point1">1</A> Entscheidungstext mit genügend Inhalt.</P>',
    })),
  } as unknown as Pick<AxiosInstance, 'get' | 'post'>;
}

describe('IcuDataClient', () => {
  it('normalizes InfoCuria case law and retrieves content', async () => {
    const transport = http();
    const data = new IcuDataClient(transport);
    const page = await data.search({ query: 'privacy', limit: 1 });
    expect(page.results[0]).toMatchObject({
      resourceType: 'case-law',
      jurisdiction: 'EU',
      court: 'Gerichtshof',
      fileNumber: 'C-1/26',
      ecli: 'ECLI:EU:C:2026:1',
      provenance: { providerDocumentId: '62026CJ0001' },
    });
    expect((await data.get(page.results[0]!)).content.value).toContain('[Rn. 1]{.rn}');
  });

  it('falls back to the EUR-Lex ECLI URL when no CELEX id is present', async () => {
    const transport = http([{
      content: {
        docType: 'Urteil',
        docDate: '2026-01-01',
        idPublished: 'C-1/26',
        ecli: 'ECLI:EU:C:2026:1',
        affairJurisdiction: 'Gerichtshof',
        logicDocId: 'id_123',
      },
    }]);
    const data = new IcuDataClient(transport);
    const page = await data.search({ query: 'privacy', limit: 1 });
    expect(page.results[0]?.provenance.canonicalUrl).toBe(
      'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=ecli:ECLI:EU:C:2026:1',
    );
  });

  // A logicDocId alone is deliberately not enough: the curia.europa.eu viewer
  // URL built from it answers 200 but serves no document text, so emitting it
  // would be a dead link dressed up as an official source.
  it('omits canonicalUrl when neither a CELEX id nor an ECLI is available', async () => {
    const transport = http([{
      content: { docType: 'Urteil', idPublished: 'C-2/26', logicDocId: 'id_456' },
    }]);
    const data = new IcuDataClient(transport);
    const page = await data.search({ query: 'privacy', limit: 1 });
    expect(page.results[0]?.provenance.canonicalUrl).toBeUndefined();
  });

  it('resolves numeric, published and CELEX identifiers', async () => {
    const transport = http();
    const data = new IcuDataClient(transport);
    await data.getCaseLaw('123', 'DE');
    await data.getCaseLaw('C-1/26', 'DE');
    await data.getCaseLaw('62026CJ0001', 'EN');
    expect(transport.get).toHaveBeenCalledWith(
      expect.stringContaining('/123/DE/html'),
      expect.any(Object),
    );
    // C-1/26 → 62026CJ0001: sector 6, year, judgment code, padded number.
    expect(transport.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ searchTerm: '62026CJ0001' }),
      expect.any(Object),
    );
    expect(transport.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ searchTerm: '62026CJ0001' }),
      expect.any(Object),
    );
  });

  it('sends the complete current search contract and exact identifier filters', () => {
    expect(createSearchPayload('Datenschutz', 'de', 5)).toMatchObject({
      searchTerm: 'Datenschutz',
      sortTermList: [{ sortDirection: 'DESC', sortTerm: 'SCORE' }],
      pagination: { pageNumber: 0, pageSize: 5, from: 1, to: 10 },
      language: 'DE',
      publishedId: '',
      ecli: '',
      logicDocId: '',
      repJurExpand: '',
      filtersValue: [],
      advancedFiltersValue: [],
    });
    expect(createSearchPayload('C-311/18', 'DE', 1)).toMatchObject({
      searchTerm: '"C-311/18"',
      publishedId: 'C-311/18',
    });
    expect(createSearchPayload('ecli:eu:c:2020:559', 'DE', 1)).toMatchObject({
      ecli: 'ECLI:EU:C:2020:559',
    });
  });

  it('filters scope, validates references and reports missing ids', async () => {
    const data = new IcuDataClient(http([]));
    for (const request of [
      { query: 'x', resourceTypes: ['legislation'] as const },
      { query: 'x', jurisdictions: ['DE'] },
      { query: 'x', sourceIds: ['other'] },
    ]) {
      await expect(data.search(request)).resolves.toEqual({ results: [], failures: [] });
    }
    await expect(data.getCaseLaw('C-9/99')).resolves.toBeNull();
    const wrong = {
      resourceType: 'case-law',
      title: 'x',
      provenance: { providerId: 'other', sourceId: 'icu:infocuria', providerDocumentId: 'x' },
      rights: { access: 'public', fullTextStorage: 'allowed', redistribution: 'unknown' },
    } as CaseLawReference;
    await expect(data.get(wrong)).rejects.toThrow('does not belong');
  });
});

describe('celexCandidates', () => {
  it('converts published case numbers verified against live InfoCuria data', () => {
    // Each pair was confirmed live: the CELEX form resolves, the bare case
    // number does not.
    expect(celexCandidates('C-476/17')[0]).toBe('62017CJ0476');
    expect(celexCandidates('C-797/23')[0]).toBe('62023CJ0797');
    expect(celexCandidates('T-108/25')[0]).toBe('62025TJ0108');
  });

  it('offers the order code as a fallback, since the case number cannot reveal it', () => {
    expect(celexCandidates('C-476/17')).toEqual(['62017CJ0476', '62017CO0476']);
    expect(celexCandidates('T-108/25')).toEqual(['62025TJ0108', '62025TO0108']);
  });

  it('pads the case number and expands two-digit years around the 1953 start', () => {
    expect(celexCandidates('C-1/26')[0]).toBe('62026CJ0001');
    expect(celexCandidates('C-6/64')[0]).toBe('61964CJ0006');   // Costa v ENEL era
    expect(celexCandidates('C-476/2017')[0]).toBe('62017CJ0476'); // four-digit year
  });

  it('returns nothing for input that is not a published case number', () => {
    expect(celexCandidates('62017CJ0476')).toEqual([]);
    expect(celexCandidates('id_320668')).toEqual([]);
    expect(celexCandidates('Pelham')).toEqual([]);
  });
});

describe('IcuDataClient enumeration', () => {
  function sparqlHttp(rows: Record<string, { value: string }>[]) {
    return {
      get: vi.fn(async () => ({ data: { results: { bindings: rows } } })),
      post: vi.fn(),
    } as unknown as Pick<AxiosInstance, 'get' | 'post'> & { get: ReturnType<typeof vi.fn> };
  }

  const row = (celex: string, ecli?: string) => ({
    celex: { value: celex },
    title: { value: `Urteil ${celex}` },
    date: { value: '2026-01-15' },
    ...(ecli ? { ecli: { value: ecli } } : {}),
  });

  it('walks Cellar sector 6, not InfoCuria, and reports native origin', async () => {
    const http = sparqlHttp([row('62026CJ0001', 'ECLI:EU:C:2026:1')]);
    const page = await new IcuDataClient(http).enumerate({ since: '2026-01-01' });

    expect(page.origin).toBe('native');
    const query = http.get.mock.calls[0]?.[1]?.params?.query as string;
    expect(query).toContain('publications.europa.eu');
    expect(query).toContain('FILTER(?d >= "2026-01-01"^^xsd:date)');
    // One row per CELEX. SELECT DISTINCT is distinct over the whole tuple, so
    // a work with two titles or ECLIs emitted the same document twice.
    expect(query).toContain('GROUP BY ?celex');
    expect(page.results[0]).toMatchObject({
      resourceType: 'case-law',
      jurisdiction: 'EU',
      ecli: 'ECLI:EU:C:2026:1',
      decisionDate: '2026-01-15',
      provenance: expect.objectContaining({
        providerId: 'icu',
        providerDocumentId: '62026CJ0001',
      }),
    });
  });

  it('restricts to canonical CELEX so every reference stays resolvable by get', async () => {
    const http = sparqlHttp([row('62026CJ0001')]);
    await new IcuDataClient(http).enumerate();
    const query = http.get.mock.calls[0]?.[1]?.params?.query as string;
    // Corrigenda "…(01)" and summaries "…_RES" duplicate their parent's ECLI
    // and are exactly the forms isCelex rejects, so get() could not resolve
    // them back to an InfoCuria document.
    expect(query).toContain('REGEX(STR(?celex)');
    expect(query).toContain('^6\\\\d{4}(CJ|CO|CC|CV|TJ|TO|TC)\\\\d+$');
  });

  it('excludes Official Journal notices, which are announcements not decisions', async () => {
    const http = sparqlHttp([row('62026CJ0001')]);
    await new IcuDataClient(http).enumerate();
    const query = http.get.mock.calls[0]?.[1]?.params?.query as string;

    // CA/CB/CN/TA/TN all open "Amtsblatt der Europäischen Union". They are
    // excluded by type rather than by length because the longest measured
    // 2.033 characters — above any floor that still admits a short order.
    for (const notice of ['CA', 'CB', 'CN', 'TA', 'TN']) {
      expect(query).not.toContain(`|${notice}|`);
    }
    for (const decision of ['CJ', 'TJ', 'CC', 'TC', 'CO', 'TO', 'CV']) {
      expect(query).toContain(decision);
    }
  });

  it('survives a work that publishes no ECLI', async () => {
    const http = sparqlHttp([row('62026CJ0002')]);
    const page = await new IcuDataClient(http).enumerate();
    expect(page.results[0]?.ecli).toBeUndefined();
    expect(page.results[0]?.title).toBe('Urteil 62026CJ0002');
  });
});

describe('IcuDataClient Cellar fast path', () => {
  const celexRef = (id: string) => ({
    resourceType: 'case-law',
    title: 'Urteil',
    language: 'de',
    provenance: { providerId: 'icu', sourceId: 'icu:infocuria', providerDocumentId: id },
    rights: { access: 'public', fullTextStorage: 'allowed', redistribution: 'unknown' },
  } as CaseLawReference);

  const judgment = `<html><body><p>${'Urteil des Gerichtshofs zur Vorlage zur Vorabentscheidung. '.repeat(60)}</p></body></html>`;
  // What Cellar actually returns for an order published only as an OJ notice —
  // 427 characters live, of which none are the decision.
  const ojNotice = '<html><body><p>Amtsblatt der Europäischen Union C/2026/361 Beschluss des Gerichts</p></body></html>';
  // EUR-Lex answers "not in this language" with its whole site page, at 200.
  const interstitial = `<html lang="en"><body><div id="op-header-language">Select your language</div><p>${'EUR-Lex CELEX chrome. '.repeat(200)}</p></body></html>`;
  const english = `<html><body><p>${'JUDGMENT OF THE GENERAL COURT (Third Chamber). '.repeat(60)}</p></body></html>`;

  function transport(byLang: Record<string, string | Error>) {
    return {
      get: vi.fn(async (url: string) => {
        const lang = url.match(/legal-content\/([A-Z]{2})\//)?.[1];
        if (lang) {
          const answer = byLang[lang];
          if (answer === undefined) throw new Error('404');
          if (answer instanceof Error) throw answer;
          return { data: answer };
        }
        return { data: '<P><A NAME="point1">1</A> InfoCuria-Text mit genügend Inhalt.</P>' };
      }),
      post: vi.fn(async () => ({ data: { totalHits: 1, searchHits: [{ content }] } })),
    } as unknown as Pick<AxiosInstance, 'get' | 'post'> & {
      get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>;
    };
  }

  it('serves a CELEX reference from Cellar in one request, without touching InfoCuria', async () => {
    const t = transport({ DE: judgment });
    const doc = await new IcuDataClient(t).get(celexRef('62017CJ0476'));

    expect(doc.content.value).toContain('Vorabentscheidung');
    expect(t.post).not.toHaveBeenCalled();
    expect(t.get).toHaveBeenCalledTimes(1);
  });

  it('falls back to InfoCuria when Cellar has only the OJ notice', async () => {
    const t = transport({ DE: ojNotice, EN: ojNotice });
    const doc = await new IcuDataClient(t).get(celexRef('62014TB0684'));

    // Returning the announcement instead of the decision is the failure the
    // length check exists to prevent.
    expect(doc.content.value).not.toContain('Amtsblatt');
    expect(doc.content.value).toContain('InfoCuria-Text');
    expect(t.post).toHaveBeenCalled();
  });

  it('falls back when Cellar does not hold the document at all', async () => {
    const t = transport({ DE: new Error('404'), EN: new Error('404') });
    const doc = await new IcuDataClient(t).get(celexRef('62026CJ0001'));
    expect(doc.content.value).toContain('InfoCuria-Text');
  });

  it('leaves non-CELEX ids on the InfoCuria path untouched', async () => {
    const t = transport({ DE: judgment });
    const doc = await new IcuDataClient(t).get(celexRef('id_123'));
    expect(doc.content.value).toContain('InfoCuria-Text');
    expect(t.get).not.toHaveBeenCalledWith(expect.stringContaining('legal-content'), expect.anything());
  });

  it('falls back to English and says so when German is not published', async () => {
    // The Court translates every case title but not every case text, so a
    // reference enumerated from a German title can still be English-only.
    const t = transport({ DE: interstitial, EN: english });
    const doc = await new IcuDataClient(t).get(celexRef('62021TJ0127'));

    expect(doc.content.value).toContain('JUDGMENT OF THE GENERAL COURT');
    expect(doc.reference.language).toBe('en');
    expect(t.post).not.toHaveBeenCalled();
  });

  it('keeps the reference language when German is published', async () => {
    const t = transport({ DE: judgment });
    const doc = await new IcuDataClient(t).get(celexRef('62018CJ0311'));
    expect(doc.reference.language).toBe('de');
  });
});
