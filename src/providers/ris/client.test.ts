import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RisClient, parseSearch, selectCurrentNormReference } from './client.js';
import { toArray } from './types.js';
import { RisApiError } from './errors.js';
import type { OgdResponse } from './types.js';

/** Both fixtures are REAL, trimmed responses captured from data.bka.gv.at (v2.6). */
function loadFixture(name: string): OgdResponse {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8'),
  ) as OgdResponse;
}
const judikatur = loadFixture('judikatur-search.json');
const bundesrecht = loadFixture('bundesrecht-search.json');
const landesrecht = loadFixture('landesrecht-search.json');
const vwgh = loadFixture('judikatur-vwgh-search.json');
const norm = loadFixture('norm-search.json');

describe('toArray', () => {
  it('normalizes undefined, null, single object, and array alike', () => {
    expect(toArray(undefined)).toEqual([]);
    expect(toArray(null)).toEqual([]);
    expect(toArray('x')).toEqual(['x']);
    expect(toArray(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('parseSearch — real Judikatur (OGH) response', () => {
  it('extracts total, court, ECLI, date, a readable Rechtssatz title, and the HTML content URL', () => {
    const result = parseSearch(judikatur, 10);
    expect(result.total).toBe(15);
    expect(result.hits).toHaveLength(1);

    const hit = result.hits[0];
    expect(hit?.id).toBe('JJR_19960812_OGH0002_0040OB02161_96I0000_002');
    expect(hit?.applikation).toBe('Justiz');
    expect(hit?.organ).toBe('OGH');
    expect(hit?.ecli).toBe('ECLI:AT:OGH0002:1996:RS0106668');
    expect(hit?.date).toBe('2020-12-10');
    // Title now uses the Rechtssatznummer instead of the huge Geschäftszahl list.
    expect(hit?.title).toBe('Rechtssatz RS0106668');
    expect(hit?.contentUrl).toMatch(/^https:\/\/www\.ris\.bka\.gv\.at\/.*\.html$/);
  });

  it('links the full decision texts (Entscheidungstexte), newest first', () => {
    const hit = parseSearch(judikatur, 10).hits[0];
    expect(hit?.decisionTexts).toHaveLength(3);
    const newest = hit?.decisionTexts?.[0];
    expect(newest?.id).toBe('JJT_20201210_OGH0002_0040OB00182_20Y0000_000');
    expect(newest?.date).toBe('2020-12-10');
    expect(newest?.geschaeftszahl).toBe('4 Ob 182/20y');
  });

  it('respects the limit', () => {
    expect(parseSearch(judikatur, 0).hits).toHaveLength(0);
  });
});

describe('parseSearch — non-Justiz (VwGH) decision link', () => {
  it('extracts the single linked Entscheidungstext from EntscheidungstextUrl', () => {
    const hit = parseSearch(vwgh, 10).hits[0];
    expect(hit?.applikation).toBe('Vwgh');
    expect(hit?.title).toContain('Ra 2024/02/0082');
    expect(hit?.decisionTexts?.[0]?.id).toBe('JWT_2024020082_20260423L00');
  });
});

describe('parseSearch — API error envelope', () => {
  it('throws RisApiError with the API message instead of silently returning empty', () => {
    const errorResponse: OgdResponse = {
      OgdSearchResult: { Error: { Applikation: 'Justiz', Message: 'Schema Validation Error: bad column' } },
    };
    expect(() => parseSearch(errorResponse, 10)).toThrow(RisApiError);
    expect(() => parseSearch(errorResponse, 10)).toThrow(/Schema Validation Error/);
  });

  it('throws RisApiError (not a raw TypeError) on an empty/invalid body', () => {
    expect(() => parseSearch(null as unknown as OgdResponse, 10)).toThrow(RisApiError);
  });
});

describe('parseSearch — real Bundesrecht (BrKons) response', () => {
  it('reads the Bundesrecht metadata block (Kurztitel) — the branch the Judikatur fixture never exercises', () => {
    const result = parseSearch(bundesrecht, 10);
    expect(result.total).toBe(515);

    const hit = result.hits[0];
    expect(hit?.id).toBe('NOR12018914');
    expect(hit?.applikation).toBe('BrKons');
    expect(hit?.title).toBe('Allgemeines bürgerliches Gesetzbuch');
    expect(hit?.contentUrl).toMatch(/\.html$/);
  });
});

describe('parseSearch — real Landesrecht response', () => {
  it('reads the Landesrecht block (Kurztitel + Bundesland)', () => {
    const result = parseSearch(landesrecht, 10);
    expect(result.total).toBe(304);

    const hit = result.hits[0];
    expect(hit?.id).toBe('LGBLA_TI_20260706_51');
    expect(hit?.bundesland).toBe('Tirol');
    expect(hit?.title).toContain('Tiroler Bauordnung');
    expect(hit?.contentUrl).toMatch(/\.html$/);
  });
});

describe('RisClient.search (request mapping, mocked transport)', () => {
  it('maps judikatur to the right endpoint, court, and page-size enum', async () => {
    const get = vi.fn().mockResolvedValue({ data: judikatur });
    const client = new RisClient({ get });

    await client.search('judikatur', { query: 'Werknutzung', court: 'Justiz', limit: 10 });

    expect(get).toHaveBeenCalledWith(
      'https://data.bka.gv.at/ris/api/v2.6/Judikatur',
      expect.objectContaining({
        params: expect.objectContaining({
          Suchworte: 'Werknutzung',
          Applikation: 'Justiz',
          DokumenteProSeite: 'Ten',
          Seitennummer: 1,
        }),
      }),
    );
  });

  it('omits the court param for bundesrecht and maps a larger limit to Fifty', async () => {
    const get = vi.fn().mockResolvedValue({ data: bundesrecht });
    const client = new RisClient({ get });

    await client.search('bundesrecht', { query: 'ABGB', limit: 40 });

    const [url, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toBe('https://data.bka.gv.at/ris/api/v2.6/Bundesrecht');
    expect(config.params.DokumenteProSeite).toBe('Fifty');
    expect(config.params.Applikation).toBeUndefined();
  });

  it('can restrict a legislation search to consolidated law titles', async () => {
    const get = vi.fn().mockResolvedValue({ data: bundesrecht });
    const client = new RisClient({ get });

    await client.search('bundesrecht', {
      query: 'Datenschutzgesetz',
      consolidatedOnly: true,
      searchField: 'title',
      limit: 10,
    });

    const [, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params).toMatchObject({
      Titel: 'Datenschutzgesetz',
      Applikation: 'BrKons',
      DokumenteProSeite: 'Ten',
    });
    expect(config.params.Suchworte).toBeUndefined();
  });

  it('sort="date" adds a newest-first server-side ordering (Datum, descending)', async () => {
    const get = vi.fn().mockResolvedValue({ data: judikatur });
    const client = new RisClient({ get });

    await client.search('judikatur', { query: 'x', sort: 'date', limit: 1 });

    const [, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params['Sortierung.SortedByColumn']).toBe('Datum');
    expect(config.params['Sortierung.SortDirection']).toBe('Descending');
  });

  it('sort="relevance" (default) sends no Sortierung params', async () => {
    const get = vi.fn().mockResolvedValue({ data: judikatur });
    const client = new RisClient({ get });

    await client.search('judikatur', { query: 'x', limit: 1 });

    const [, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params['Sortierung.SortedByColumn']).toBeUndefined();
  });

  it('routes landesrecht to the Landesrecht endpoint', async () => {
    const get = vi.fn().mockResolvedValue({ data: landesrecht });
    const client = new RisClient({ get });

    await client.search('landesrecht', { query: 'Bauordnung', limit: 10 });

    const [url] = get.mock.calls[0] as [string, unknown];
    expect(url).toBe('https://data.bka.gv.at/ris/api/v2.6/Landesrecht');
  });

  it('bundesland filter selects consolidated state law (LrKons + nested SucheIn flag)', async () => {
    const get = vi.fn().mockResolvedValue({ data: landesrecht });
    const client = new RisClient({ get });

    await client.search('landesrecht', { query: 'Bauordnung', bundesland: 'Wien', limit: 10 });

    const [, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params.Applikation).toBe('LrKons');
    expect(config.params['Bundesland.SucheInWien']).toBe('true');
  });
});

describe('RisClient.getNorm', () => {
  it('prefers the current consolidated version when RIS returns historical versions first', async () => {
    const historical = {
      Data: { Metadaten: {
        Technisch: { ID: 'OLD', Applikation: 'BrKons' },
        Bundesrecht: { Kurztitel: 'DSG', BrKons: {
          Inkrafttretensdatum: '1980-01-01', Ausserkrafttretensdatum: '1999-12-31',
        } },
      } },
    };
    const current = {
      Data: { Metadaten: {
        Technisch: { ID: 'CURRENT', Applikation: 'BrKons' },
        Allgemein: { Geaendert: '2024-04-05' },
        Bundesrecht: { Kurztitel: 'DSG', BrKons: { Inkrafttretensdatum: '2014-01-01' } },
      } },
    };
    const get = vi.fn().mockResolvedValue({
      data: { OgdSearchResult: { OgdDocumentResults: {
        Hits: { '#text': '2', '@pageNumber': '1' },
        OgdDocumentReference: [historical, current],
      } } },
    });
    const client = new RisClient({ get });

    const result = await client.getNorm('bundesrecht', { law: 'DSG', paragraph: '1' });

    expect(result.hits[0]?.id).toBe('CURRENT');
  });

  it('selects the current version for whole-law resolution as well', () => {
    const refs = [
      { Data: { Metadaten: { Bundesrecht: { BrKons: { Inkrafttretensdatum: '1980-01-01', Ausserkrafttretensdatum: '1999-12-31' } } } } },
      { Data: { Metadaten: { Bundesrecht: { BrKons: { Inkrafttretensdatum: '2014-01-01' } } } } },
    ];

    expect(selectCurrentNormReference(refs)?.Data?.Metadaten?.Bundesrecht?.BrKons?.Inkrafttretensdatum)
      .toBe('2014-01-01');
  });

  it('federal: maps to BrKons + Abschnitt paragraph filter', async () => {
    const get = vi.fn().mockResolvedValue({ data: norm });
    const client = new RisClient({ get });

    await client.getNorm('bundesrecht', { law: 'ABGB', paragraph: '1295' });

    const [url, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toBe('https://data.bka.gv.at/ris/api/v2.6/Bundesrecht');
    expect(config.params.Applikation).toBe('BrKons');
    expect(config.params.Titel).toBe('ABGB');
    expect(config.params['Abschnitt.Von']).toBe('1295');
    expect(config.params['Abschnitt.Bis']).toBe('1295');
    expect(config.params['Abschnitt.Typ']).toBe('Paragraph');
  });

  it('state: maps to LrKons + the Bundesland flag', async () => {
    const get = vi.fn().mockResolvedValue({ data: norm });
    const client = new RisClient({ get });

    await client.getNorm('landesrecht', { law: 'Bauordnung', paragraph: '60', bundesland: 'Wien' });

    const [url, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toBe('https://data.bka.gv.at/ris/api/v2.6/Landesrecht');
    expect(config.params.Applikation).toBe('LrKons');
    expect(config.params['Bundesland.SucheInWien']).toBe('true');
  });
});
