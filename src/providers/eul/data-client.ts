import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type {
  LegalDataProvider,
  LegalResourceDocument,
  LegalSearchPage,
  LegalSearchRequest,
  LegislationReference,
} from '../../contracts/legal-resource.js';
import type {
  CorpusEnumerationCapability,
  CorpusEnumerationPage,
  CorpusEnumerationRequest,
} from '../../contracts/provider-capabilities.js';
import { EulConverter } from './converter.js';
import { safeAxiosGet } from '../../shared/network-policy.js';
import { isoDateLiteral, sparqlStringLiteral } from '../../shared/sparql.js';
import { CELLAR_LANGUAGES, fetchCellarText } from '../../shared/cellar.js';
import { EulBotChallengeError, EulDocumentNotFoundError } from './errors.js';
import { CELEX_PATTERN, EUL_SPARQL_POLICY } from './network-policy.js';

const SPARQL_URL = 'https://publications.europa.eu/webapi/rdf/sparql';

const LANG_MAP = CELLAR_LANGUAGES;

/** A consolidated-text CELEX without its `-YYYYMMDD` version suffix. */
const UNDATED_CONSOLIDATED_CELEX = /^0[0-9]{4}[A-Z][0-9]{4}$/i;
const CONSOLIDATED_CELEX = /^0[0-9]{4}[A-Z][0-9]{4}-([0-9]{4})([0-9]{2})([0-9]{2})$/i;

export interface EulLegislationText {
  /** The CELEX actually served — for an undated consolidated request, the resolved version. */
  readonly celex: string;
  readonly language: string;
  readonly markdown: string;
  /** `official-journal` for the text as published, `consolidated` for a consolidated version. */
  readonly version: 'official-journal' | 'consolidated';
  /** ISO date of the consolidated version, when `version` is `consolidated`. */
  readonly consolidationDate?: string;
  /** Other consolidated versions known for the act, newest first (undated requests only). */
  readonly otherVersions?: readonly string[];
}

const RESOURCE_TYPES: Record<string, string> = {
  directive: 'DIR', regulation: 'REG', decision: 'DEC', treaty: 'TREATY',
};

const RIGHTS = {
  access: 'public',
  fullTextStorage: 'allowed',
  redistribution: 'unknown',
  licence: 'NOASSERTION',
} as const;

export interface EulSearchResult {
  readonly celex: string;
  readonly title: string;
  readonly language: string;
  readonly documentDate?: string;
}

interface SparqlResponse {
  readonly results?: {
    readonly bindings?: Array<Record<string, { value?: string }>>;
  };
}

const DEFAULT_ENUMERATION_LIMIT = 500;
const MAX_ENUMERATION_LIMIT = 2_000;

/**
 * SPARQL has no cursor, and `OFFSET` over a live store is not stable — rows
 * inserted between pages shift every later offset. Keyset paging on the CELEX
 * number is stable by construction: each page asks for what sorts after the
 * last identifier it saw.
 */
function keysetFilter(cursor: string | undefined): string {
  return cursor ? `FILTER(STR(?celex) > ${sparqlStringLiteral(cursor)})` : '';
}

export class EulDataClient
implements LegalDataProvider<LegislationReference>, CorpusEnumerationCapability<LegislationReference> {
  constructor(
    private readonly http: Pick<AxiosInstance, 'get'> = axios,
    private readonly converter: EulConverter = new EulConverter(),
  ) {}

  async searchLegislation(
    query: string,
    options: { resourceType?: string; language?: string; limit?: number } = {},
  ): Promise<EulSearchResult[]> {
    const language = (options.language ?? 'DE').toUpperCase();
    const lang3 = LANG_MAP[language] || 'DEU';
    const resourceType = options.resourceType ?? 'any';
    const typeFilter = resourceType !== 'any' && RESOURCE_TYPES[resourceType]
      ? `?work cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/${RESOURCE_TYPES[resourceType]}> .`
      : '';
    const sparql = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?title WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  ${typeFilter}
  ?expr cdm:expression_belongs_to_work ?work .
  ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${lang3}> .
  ?expr cdm:expression_title ?title .
  FILTER(CONTAINS(LCASE(?title), LCASE(${sparqlStringLiteral(query)})))
} LIMIT ${Math.min(Math.max(1, options.limit ?? 10), 100)}`;
    const response = await safeAxiosGet<SparqlResponse>(this.http, SPARQL_URL, EUL_SPARQL_POLICY, {
      params: { query: sparql },
      headers: { 'Accept': 'application/sparql-results+json' },
      timeout: 30_000,
      maxContentLength: 10 * 1024 * 1024,
    });
    const bindings = response.data.results?.bindings ?? [];
    return bindings.map((binding: Record<string, { value?: string }>) => ({
      celex: binding.celex?.value ?? 'unknown',
      title: binding.title?.value ?? '',
      language: language.toLowerCase(),
    }));
  }

  async getLegislation(celex: string, language = 'DE'): Promise<string> {
    return (await this.getLegislationText(celex, language)).markdown;
  }

  /**
   * Full text from Cellar. A CELEX starting with `3` (or another sector
   * digit) yields the act as published in the Official Journal; `0…-YYYYMMDD`
   * yields that consolidated version, and a bare `0…` resolves to the latest
   * consolidated version already in force.
   */
  async getLegislationText(celex: string, language = 'DE'): Promise<EulLegislationText> {
    if (!CELEX_PATTERN.test(celex)) throw new Error(`Invalid CELEX identifier: ${celex}`);
    const normalizedLanguage = language.toUpperCase();
    const lang3 = LANG_MAP[normalizedLanguage];
    if (!lang3) throw new Error(`Invalid EUR-Lex language: ${language}`);

    let requested = celex.toUpperCase();
    let otherVersions: string[] | undefined;
    if (UNDATED_CONSOLIDATED_CELEX.test(requested)) {
      const versions = await this.consolidatedVersions(requested);
      const current = currentVersion(versions);
      if (!current) throw new EulDocumentNotFoundError(requested, normalizedLanguage);
      otherVersions = versions.filter((version) => version !== current);
      requested = current;
    }

    const text = await fetchCellarText(this.http, requested, normalizedLanguage);
    if (text.kind === 'challenge') throw new EulBotChallengeError(text.url);
    if (text.kind === 'missing') throw new EulDocumentNotFoundError(requested, normalizedLanguage);

    const consolidated = CONSOLIDATED_CELEX.exec(requested);
    return {
      celex: requested,
      language: normalizedLanguage,
      markdown: this.converter.convert(text.html),
      version: consolidated ? 'consolidated' : 'official-journal',
      ...(consolidated ? { consolidationDate: `${consolidated[1]}-${consolidated[2]}-${consolidated[3]}` } : {}),
      ...(otherVersions ? { otherVersions } : {}),
    };
  }

  /** Every consolidated version of one act, newest first. */
  async consolidatedVersions(baseCelex: string): Promise<string[]> {
    if (!UNDATED_CONSOLIDATED_CELEX.test(baseCelex)) {
      throw new Error(`Not a consolidated CELEX base: ${baseCelex}`);
    }
    const base = baseCelex.toUpperCase();
    // Indexed lookup through the consolidation relation of the published act
    // (sector 3). It also returns consolidations of acts that this act amends,
    // hence the prefix filter below.
    const related = await this.sparqlCelexList(`PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?celex WHERE {
  ?act cdm:resource_legal_id_celex ${sparqlStringLiteral(`3${base.slice(1)}`)}^^xsd:string .
  ?consolidated cdm:act_consolidated_consolidates_resource_legal ?act .
  ?consolidated cdm:resource_legal_id_celex ?celex .
} LIMIT 1000`);
    let versions = related.filter((celex) => celex.startsWith(`${base}-`));
    if (versions.length === 0) {
      // Acts outside sector 3 have no such link; a prefix scan finds them, slowly.
      versions = (await this.sparqlCelexList(`PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  FILTER(STRSTARTS(STR(?celex), ${sparqlStringLiteral(`${base}-`)}))
} LIMIT 200`)).filter((celex) => celex.startsWith(`${base}-`));
    }
    return [...new Set(versions.filter((value) => CONSOLIDATED_CELEX.test(value)))].sort().reverse();
  }

  private async sparqlCelexList(sparql: string): Promise<string[]> {
    const response = await safeAxiosGet<SparqlResponse>(this.http, SPARQL_URL, EUL_SPARQL_POLICY, {
      params: { query: sparql },
      headers: { 'Accept': 'application/sparql-results+json' },
      timeout: 60_000,
      maxContentLength: 1024 * 1024,
    });
    return (response.data.results?.bindings ?? [])
      .map((binding) => binding.celex?.value?.toUpperCase() ?? '')
      .filter((value) => value.length > 0);
  }

  async search(request: LegalSearchRequest): Promise<LegalSearchPage<LegislationReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('legislation')) {
      return { results: [], failures: [] };
    }
    if (request.jurisdictions && !request.jurisdictions.some((id) => id.toUpperCase() === 'EU')) {
      return { results: [], failures: [] };
    }
    if (request.sourceIds && !request.sourceIds.includes('eul:cellar')) {
      return { results: [], failures: [] };
    }
    const results = await this.searchLegislation(request.query, {
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
    return { results: results.map(toReference), failures: [] };
  }

  /**
   * Walk the Cellar store by CELEX order.
   *
   * `origin` is `native`: `cdm:work_date_document` is filtered in the query, so
   * a delta run transfers only the delta. That makes this the cheapest source
   * in the set to keep current — the opposite of GII, which publishes no dates
   * at all and has to be swept.
   *
   * Titles come from the German expression, matching the rest of the provider;
   * a work with no German expression is not enumerated, which is the intended
   * trade for a German-practice corpus.
   */
  async enumerate(request: CorpusEnumerationRequest = {}): Promise<CorpusEnumerationPage<LegislationReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('legislation')) {
      return { results: [], failures: [], origin: 'native' };
    }
    if (request.jurisdictions && !request.jurisdictions.some((id) => id.toUpperCase() === 'EU')) {
      return { results: [], failures: [], origin: 'native' };
    }
    const limit = Math.min(Math.max(1, request.limit ?? DEFAULT_ENUMERATION_LIMIT), MAX_ENUMERATION_LIMIT);
    const results = await this.enumerateLegislation({
      ...(request.since ? { since: request.since } : {}),
      ...(request.cursor ? { cursor: request.cursor } : {}),
      limit,
    });
    const last = results.at(-1);
    return {
      results: results.map(toReference),
      failures: [],
      // A short page means the store had nothing further to give.
      ...(results.length === limit && last ? { nextCursor: last.celex } : {}),
      origin: 'native',
    };
  }

  async enumerateLegislation(
    options: { since?: string; cursor?: string; limit?: number; language?: string } = {},
  ): Promise<EulSearchResult[]> {
    const language = (options.language ?? 'DE').toUpperCase();
    const lang3 = LANG_MAP[language] || 'DEU';
    const sinceFilter = options.since
      ? `FILTER(?date >= "${isoDateLiteral(options.since)}"^^xsd:date)`
      : '';
    const sparql = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?celex ?title ?date WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  ?work cdm:work_date_document ?date .
  ?expr cdm:expression_belongs_to_work ?work .
  ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${lang3}> .
  ?expr cdm:expression_title ?title .
  ${sinceFilter}
  ${keysetFilter(options.cursor)}
} ORDER BY ?celex LIMIT ${Math.min(Math.max(1, options.limit ?? DEFAULT_ENUMERATION_LIMIT), MAX_ENUMERATION_LIMIT)}`;
    const response = await safeAxiosGet<SparqlResponse>(this.http, SPARQL_URL, EUL_SPARQL_POLICY, {
      params: { query: sparql },
      headers: { 'Accept': 'application/sparql-results+json' },
      timeout: 30_000,
      maxContentLength: 10 * 1024 * 1024,
    });
    const bindings = response.data.results?.bindings ?? [];
    return bindings.map((binding: Record<string, { value?: string }>) => ({
      celex: binding.celex?.value ?? 'unknown',
      title: binding.title?.value ?? '',
      language: language.toLowerCase(),
      ...(binding.date?.value ? { documentDate: binding.date.value } : {}),
    }));
  }

  async get(reference: LegislationReference): Promise<LegalResourceDocument<LegislationReference>> {
    assertReference(reference);
    const language = reference.language?.toUpperCase() ?? 'DE';
    return {
      reference,
      content: {
        format: 'markdown',
        value: await this.getLegislation(reference.provenance.providerDocumentId, language),
      },
    };
  }
}

/**
 * The newest version already in force. Cellar also lists consolidations dated
 * in the future (amendments applying later); those are not the current law.
 */
function currentVersion(versionsNewestFirst: readonly string[], today = new Date()): string | undefined {
  const cutoff = today.toISOString().slice(0, 10).replaceAll('-', '');
  return versionsNewestFirst.find((version) => (version.split('-')[1] ?? '') <= cutoff)
    ?? versionsNewestFirst.at(-1);
}

function toReference(result: EulSearchResult): LegislationReference {
  return {
    resourceType: 'legislation',
    title: result.title,
    jurisdiction: 'EU',
    language: result.language,
    celex: result.celex,
    ...(result.documentDate ? { publicationDate: result.documentDate } : {}),
    provenance: {
      providerId: 'eul',
      sourceId: 'eul:cellar',
      providerDocumentId: result.celex,
      canonicalUrl: `https://eur-lex.europa.eu/legal-content/${result.language.toUpperCase()}/TXT/?uri=CELEX:${result.celex}`,
    },
    rights: RIGHTS,
  };
}

function assertReference(reference: LegislationReference): void {
  if (reference.provenance.providerId !== 'eul') {
    throw new Error(`Reference does not belong to eul: ${reference.provenance.providerId}`);
  }
}
