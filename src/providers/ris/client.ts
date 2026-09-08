import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { HTTP_USER_AGENT } from '../../config.js';
import { safeAxiosGet } from '../../shared/network-policy.js';
import { toArray } from './types.js';
import { RisApiError } from './errors.js';
import { RIS_API_POLICY, RIS_DOCUMENT_POLICY } from './network-policy.js';
import type {
  OgdMetadaten,
  OgdReference,
  OgdResponse,
  RisApplication,
  RisDecisionRef,
  RisSearchHit,
  RisSearchResult,
  RisSort,
} from './types.js';

const BASE_URL = 'https://data.bka.gv.at/ris/api/v2.6';

/**
 * Hard cap on every RIS request. The search API (data.bka.gv.at) answers in
 * well under a second, but the document server (www.ris.bka.gv.at) can hang
 * indefinitely on some large pages — without a timeout `ris_get` would never
 * return. Fail fast instead.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** RIS application → REST path segment. */
const APP_PATH: Record<RisApplication, string> = {
  bundesrecht: 'Bundesrecht',
  landesrecht: 'Landesrecht',
  judikatur: 'Judikatur',
};

/** The OGD API takes page size as an enum, not a number. */
function pageSizeEnum(limit: number): 'Ten' | 'Twenty' | 'Fifty' | 'OneHundred' {
  if (limit <= 10) return 'Ten';
  if (limit <= 20) return 'Twenty';
  if (limit <= 50) return 'Fifty';
  return 'OneHundred';
}

export interface RisSearchOptions {
  query: string;
  /** Restrict legislation search to consolidated norms instead of gazette publications. */
  consolidatedOnly?: boolean | undefined;
  /** Search only the legislation title; case-law and general searches use full text. */
  searchField?: 'all' | 'title' | undefined;
  /** Judikatur sub-application (Justiz, Vwgh, Vfgh, Bvwg, …); default "Justiz". */
  court?: string | undefined;
  /** Landesrecht Bundesland filter (ASCII: Wien, Tirol, Kaernten, …). */
  bundesland?: string | undefined;
  /** "date" sorts newest-first server-side (SortedByColumn=Datum). */
  sort?: RisSort | undefined;
  limit?: number | undefined;
  page?: number | undefined;
}

export interface RisNormOptions {
  /** Law title or abbreviation (RIS "Titel"), e.g. "ABGB". */
  law: string;
  /** Paragraph number, e.g. "1295" or "1295a". */
  paragraph: string;
  /** Required for landesrecht: the Bundesland (ASCII, e.g. "Wien"). */
  bundesland?: string | undefined;
}

export class RisClient {
  constructor(private readonly http: Pick<AxiosInstance, 'get'> = axios) {}

  async search(application: RisApplication, opts: RisSearchOptions): Promise<RisSearchResult> {
    const limit = opts.limit ?? 10;
    const params: Record<string, string | number> = {
      [opts.searchField === 'title' ? 'Titel' : 'Suchworte']: opts.query,
      DokumenteProSeite: pageSizeEnum(limit),
      Seitennummer: opts.page ?? 1,
    };
    // Judikatur is one endpoint with a mandatory court sub-application.
    if (application === 'judikatur') params.Applikation = opts.court ?? 'Justiz';
    if (opts.consolidatedOnly && application === 'bundesrecht') params.Applikation = 'BrKons';
    if (opts.consolidatedOnly && application === 'landesrecht') params.Applikation = 'LrKons';
    // Per-Bundesland filtering is only offered by the consolidated (LrKons)
    // sub-search, via a nested boolean flag, e.g. Bundesland.SucheInWien=true.
    if (application === 'landesrecht' && opts.bundesland) {
      params.Applikation = 'LrKons';
      params[`Bundesland.SucheIn${opts.bundesland}`] = 'true';
    }
    // Server-side newest-first ordering ("Datum" is the valid sortable column).
    if (opts.sort === 'date') {
      params['Sortierung.SortedByColumn'] = 'Datum';
      params['Sortierung.SortDirection'] = 'Descending';
    }

    const res = await safeAxiosGet<OgdResponse>(this.http, `${BASE_URL}/${APP_PATH[application]}`, RIS_API_POLICY, {
      params,
      headers: { 'User-Agent': HTTP_USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return parseSearch(res.data, limit, opts.consolidatedOnly);
  }

  /**
   * Retrieve a single paragraph (§) of a consolidated law via the RIS
   * `Abschnitt` (paragraph-range) filter — the surgical way to reach one §'s
   * text instead of a whole statute. Federal uses Applikation=BrKons; state uses
   * LrKons + the Bundesland flag.
   */
  async getNorm(application: 'bundesrecht' | 'landesrecht', opts: RisNormOptions): Promise<RisSearchResult> {
    const params: Record<string, string | number> = {
      Titel: opts.law,
      'Abschnitt.Von': opts.paragraph,
      'Abschnitt.Bis': opts.paragraph,
      'Abschnitt.Typ': 'Paragraph',
      DokumenteProSeite: 'Ten',
      Seitennummer: 1,
    };
    if (application === 'bundesrecht') {
      params.Applikation = 'BrKons';
    } else {
      params.Applikation = 'LrKons';
      if (opts.bundesland) params[`Bundesland.SucheIn${opts.bundesland}`] = 'true';
    }

    const res = await safeAxiosGet<OgdResponse>(this.http, `${BASE_URL}/${APP_PATH[application]}`, RIS_API_POLICY, {
      params,
      headers: { 'User-Agent': HTTP_USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return parseSearch(res.data, 10, true);
  }

  /**
   * Resolve a law's whole-law ("Gesamte Rechtsvorschrift") URL — the source of
   * its table of contents — by looking up § 1 of the named law and reading the
   * GesamteRechtsvorschriftUrl the response carries. Returns null when the law
   * can't be resolved (e.g. an abbreviation that only matches a Novelle).
   */
  async resolveWholeLawUrl(
    application: 'bundesrecht' | 'landesrecht',
    opts: { law: string; bundesland?: string | undefined },
  ): Promise<{ title: string; url: string } | null> {
    const params: Record<string, string | number> = {
      Titel: opts.law,
      'Abschnitt.Von': '1',
      'Abschnitt.Bis': '1',
      'Abschnitt.Typ': 'Paragraph',
      DokumenteProSeite: 'Ten',
      Seitennummer: 1,
    };
    if (application === 'bundesrecht') {
      params.Applikation = 'BrKons';
    } else {
      params.Applikation = 'LrKons';
      if (opts.bundesland) params[`Bundesland.SucheIn${opts.bundesland}`] = 'true';
    }

    const res = await safeAxiosGet<OgdResponse>(this.http, `${BASE_URL}/${APP_PATH[application]}`, RIS_API_POLICY, {
      params,
      headers: { 'User-Agent': HTTP_USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const refs = toArray(res.data?.OgdSearchResult?.OgdDocumentResults?.OgdDocumentReference);
    const ref = selectCurrentNormReference(refs);
    const meta = ref?.Data?.Metadaten;
    const url =
      meta?.Bundesrecht?.BrKons?.GesamteRechtsvorschriftUrl ??
      meta?.Landesrecht?.LrKons?.GesamteRechtsvorschriftUrl;
    if (!url) return null;
    const title = meta?.Bundesrecht?.Kurztitel ?? meta?.Landesrecht?.Kurztitel ?? opts.law;
    return { title, url };
  }

  async fetchHtml(url: string, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<string> {
    const res = await safeAxiosGet<string>(this.http, url, RIS_DOCUMENT_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
      timeout: timeoutMs,
    });
    return res.data;
  }
}

/** Parse an OGD search response into flattened hits (exported for testing). */
export function parseSearch(data: OgdResponse, limit: number, currentNormFirst = false): RisSearchResult {
  if (!data) {
    throw new RisApiError('Empty or invalid response from the RIS API.');
  }
  const error = data.OgdSearchResult?.Error;
  if (error) {
    throw new RisApiError(error.Message ?? `RIS API error (${error.Applikation ?? 'unknown'})`);
  }
  const results = data.OgdSearchResult?.OgdDocumentResults;
  const total = Number(results?.Hits?.['#text'] ?? 0);
  const page = Number(results?.Hits?.['@pageNumber'] ?? 1);
  const refs = toArray(results?.OgdDocumentReference);
  const orderedRefs = currentNormFirst ? orderCurrentNormReferences(refs) : refs;
  const hits = orderedRefs.slice(0, limit).map(toHit);
  return { total, page, hits };
}

/**
 * RIS returns historical and current consolidated paragraphs together. The
 * API does not guarantee that the first result is the applicable version, so
 * norm lookups must explicitly prefer an in-force version and then the latest
 * effective version.
 */
export function selectCurrentNormReference(refs: OgdReference[]): OgdReference | undefined {
  const today = new Date().toISOString().slice(0, 10);
  return [...refs].sort((a, b) => normVersionScore(b, today) - normVersionScore(a, today))[0];
}

function orderCurrentNormReferences(refs: OgdReference[]): OgdReference[] {
  const today = new Date().toISOString().slice(0, 10);
  return [...refs].sort((a, b) => normVersionScore(b, today) - normVersionScore(a, today));
}

function normVersionScore(ref: OgdReference, today: string): number {
  const meta = ref.Data?.Metadaten;
  const version = meta?.Bundesrecht?.BrKons ?? meta?.Landesrecht?.LrKons;
  const end = version?.Ausserkrafttretensdatum;
  const inForce = !end || end >= today;
  const effective = version?.Inkrafttretensdatum ?? '';
  const changed = meta?.Allgemein?.Geaendert ?? '';
  // Keep the current-version preference dominant over date ordering.
  return (inForce ? 1_000_000_000_000 : 0) + dateScore(effective) / 1000 + dateScore(changed) / 1_000_000_000;
}

function dateScore(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toHit(ref: OgdReference): RisSearchHit {
  const meta = ref.Data?.Metadaten ?? {};
  const tech = meta.Technisch ?? {};
  const bund = meta.Bundesrecht;
  const land = meta.Landesrecht;
  const jud = meta.Judikatur;

  const geschaeftszahl = jud ? toArray(jud.Geschaeftszahl?.item).join('; ') : undefined;
  const rechtssatznummer = jud ? toArray(jud.Justiz?.Rechtssatznummern?.item).join(', ') : undefined;
  const firstGz = geschaeftszahl?.split(';')[0]?.trim();
  const title =
    bund?.Kurztitel ??
    bund?.Titel ??
    land?.Kurztitel ??
    land?.Titel ??
    (rechtssatznummer ? `Rechtssatz ${rechtssatznummer}` : undefined) ??
    firstGz ??
    tech.Organ ??
    tech.ID ??
    '(ohne Titel)';

  const decisionTexts = jud ? extractDecisionTexts(jud) : [];
  const consolidated = bund?.BrKons ?? land?.LrKons;

  return {
    id: tech.ID ?? '',
    applikation: tech.Applikation ?? '',
    title,
    organ: tech.Organ,
    date: jud?.Entscheidungsdatum,
    ...(geschaeftszahl ? { fileNumber: geschaeftszahl } : {}),
    ecli: jud?.EuropeanCaseLawIdentifier,
    ...(bund?.Eli ?? land?.Eli ? { eli: bund?.Eli ?? land?.Eli } : {}),
    ...(consolidated?.Inkrafttretensdatum
      ? { validFrom: consolidated.Inkrafttretensdatum }
      : {}),
    ...(consolidated?.Ausserkrafttretensdatum
      ? { validTo: consolidated.Ausserkrafttretensdatum }
      : {}),
    ...(meta.Allgemein?.Veroeffentlicht
      ? { publicationDate: meta.Allgemein.Veroeffentlicht }
      : {}),
    documentUrl: meta.Allgemein?.DokumentUrl,
    contentUrl: pickHtmlUrl(ref),
    ...(land?.Bundesland ? { bundesland: land.Bundesland } : {}),
    ...(decisionTexts.length > 0 ? { decisionTexts } : {}),
  };
}

/** Pull the linked Entscheidungstexte (full decisions) from a Rechtssatz, newest first. */
function extractDecisionTexts(jud: NonNullable<OgdMetadaten['Judikatur']>): RisDecisionRef[] {
  const refs: RisDecisionRef[] = toArray(jud.Justiz?.Entscheidungstexte?.item).map((t) => ({
    id: t?.DokumentUrl?.match(/Dokumentnummer=([^&]+)/)?.[1] ?? '',
    date: t?.Entscheidungsdatum,
    geschaeftszahl: t?.Geschaeftszahl,
  }));

  // Non-Justiz courts (VwGH, …) link a single full decision (JWT) rather than a list.
  const singleId = jud.EntscheidungstextUrl?.match(/Dokumentnummer=([^&]+)/)?.[1];
  if (singleId) {
    refs.push({
      id: singleId,
      date: jud.Entscheidungsdatum,
      geschaeftszahl: toArray(jud.Geschaeftszahl?.item).join('; '),
    });
  }

  return refs
    .filter((t) => t.id !== '')
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

function pickHtmlUrl(ref: OgdReference): string | undefined {
  const refs = toArray(ref.Data?.Dokumentliste?.ContentReference);
  const main = refs.find((r) => r.ContentType === 'MainDocument') ?? refs[0];
  const urls = toArray(main?.Urls?.ContentUrl);
  return (urls.find((u) => u.DataType === 'Html') ?? urls[0])?.Url;
}
