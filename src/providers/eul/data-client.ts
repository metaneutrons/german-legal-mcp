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
import {
  CELEX_PATTERN,
  EUL_DOCUMENT_POLICY,
  EUL_SPARQL_POLICY,
} from './network-policy.js';

const EURLEX_HTML = 'https://eur-lex.europa.eu/legal-content';
const SPARQL_URL = 'https://publications.europa.eu/webapi/rdf/sparql';

const LANG_MAP: Record<string, string> = {
  DE: 'DEU', EN: 'ENG', FR: 'FRA', IT: 'ITA', ES: 'SPA', NL: 'NLD', PT: 'POR', PL: 'POL',
};

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
    if (!CELEX_PATTERN.test(celex)) throw new Error(`Invalid CELEX identifier: ${celex}`);
    const normalizedLanguage = language.toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalizedLanguage)) {
      throw new Error(`Invalid EUR-Lex language: ${language}`);
    }
    const response = await safeAxiosGet<string>(
      this.http,
      `${EURLEX_HTML}/${normalizedLanguage}/TXT/HTML/`,
      EUL_DOCUMENT_POLICY,
      {
      params: { uri: `CELEX:${celex.toUpperCase()}` },
      headers: {
        'Accept': 'text/html, application/xhtml+xml',
        'Accept-Language': `${normalizedLanguage.toLowerCase()}, en;q=0.8`,
      },
      timeout: 30_000,
      maxContentLength: 25 * 1024 * 1024,
      responseType: 'text',
      },
    );
    return this.converter.convert(response.data);
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
