import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type {
  CaseLawReference,
  LegalDataProvider,
  LegalResourceDocument,
  LegalSearchPage,
  LegalSearchRequest,
} from '../../contracts/legal-resource.js';
import type {
  CorpusEnumerationCapability,
  CorpusEnumerationPage,
  CorpusEnumerationRequest,
} from '../../contracts/provider-capabilities.js';
import { EulConverter } from '../eul/converter.js';
import { IcuConverter } from './converter.js';
import { classifyIcuError } from './errors.js';
import { safeAxiosGet, safeAxiosPost } from '../../shared/network-policy.js';
import { isoDateLiteral, sparqlStringLiteral } from '../../shared/sparql.js';
import {
  ICU_DOCUMENT_POLICY,
  ICU_EURLEX_POLICY,
  ICU_SEARCH_POLICY,
  ICU_SPARQL_POLICY,
} from './network-policy.js';

const SEARCH_URL = 'https://infocuriaws.curia.europa.eu/elastic-connector/search';
const BLOB_URL = 'https://infocuriaws.curia.europa.eu/blob/download-file';
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Accept': 'application/json',
  'Origin': 'https://infocuria.curia.europa.eu',
};

const RIGHTS = {
  access: 'public',
  fullTextStorage: 'allowed',
  redistribution: 'unknown',
  licence: 'NOASSERTION',
} as const;

export interface IcuSearchHit {
  readonly docType?: string;
  readonly docDate?: string;
  readonly idPublished?: string;
  readonly ecli?: string;
  readonly celex?: string;
  readonly affairJurisdiction?: string;
  readonly logicDocId?: string;
}

interface IcuSearchResponse {
  readonly totalHits?: number;
  readonly searchHits?: Array<{ readonly content?: IcuSearchHit }>;
}

interface SparqlResponse {
  readonly results?: {
    readonly bindings?: Array<Record<string, { value?: string }>>;
  };
}

const SPARQL_URL = 'https://publications.europa.eu/webapi/rdf/sparql';
const EURLEX_HTML = 'https://eur-lex.europa.eu/legal-content';

/**
 * EUR-Lex answers 200 either way, so the language a document actually came
 * back in has to be read off the response — and there is no header for it.
 * `Content-Language` is empty on every Cellar and EUR-Lex response checked,
 * the redirect target is an opaque UUID, and `lang` appears on some documents
 * and not others.
 *
 * What does separate them is the page itself: a document is served as bare
 * document HTML, while "not available in this language" is answered with the
 * full EUR-Lex site page, navigation chrome and all. This id belongs to that
 * chrome and appears in no document.
 */
const EURLEX_CHROME_MARKER = 'op-header-language';

/**
 * Below this, the response was not a decision.
 *
 * A safety net, not the primary defence — `DECISION_CELEX_SPARQL` keeps the
 * Official Journal notices out of the walk in the first place, which matters
 * because the longest of them measured 2.033 characters and would have cleared
 * any floor set low enough to admit a short order.
 *
 * What this still catches is a source answering 200 with an error body —
 * Cellar returns 214 characters reading "None of the requests returned
 * successfully a redirection." for some orders. Those are real decisions whose
 * rendering failed, and the fallback sends them to InfoCuria.
 */
const PUBLISHED_TEXT_MIN_CHARS = 2_000;
const DEFAULT_ENUMERATION_LIMIT = 500;
const MAX_ENUMERATION_LIMIT = 2_000;

/**
 * Decisions only, in canonical CELEX form.
 *
 * Two filters in one expression, for two different mistakes.
 *
 * **Form.** `62017CJ0476`, not `62014TJ0639(01)` or `62014TJ0639(01)_RES`.
 * The suffixed variants are corrigenda and summaries that share their parent's
 * ECLI, so they would enter a corpus as duplicates — and they are exactly the
 * shapes `isCelex` rejects, leaving `get` unable to resolve a reference this
 * walk had just produced.
 *
 * **Type.** Sector 6 mixes decisions with Official Journal announcements
 * *about* cases, and the announcements are not case law. Measured across a
 * 754-document sample from 2025-06 onward:
 *
 * | Type | | Chars |
 * |---|---|---|
 * | `CJ` | Court of Justice judgment | 111.559 |
 * | `TJ` | General Court judgment | 52.774 |
 * | `CC` | Advocate General's opinion | 64.900 |
 * | `TC` | Advocate General, General Court | 55.231 |
 * | `CO`/`TO` | orders | Cellar redirect fails; InfoCuria serves them |
 * | `CA` `CB` `CN` `TA` `TN` | OJ notice — *excluded* | 1.027–2.033 |
 *
 * The notice types all open "Amtsblatt der Europäischen Union". Filtering them
 * by document type rather than by length matters: `CN` measured 2.033
 * characters and would have cleared any plausible length floor, entering the
 * corpus as a decision it is not.
 *
 * The list is an allowlist because admitting an unknown type silently is worse
 * than omitting a rare one visibly. `CV` (Opinions of the Court under Art. 218
 * XI TFEU) is included as a known decision type though none appeared in the
 * sample; listing a type that never matches costs nothing, while omitting a
 * real one loses documents.
 */
const DECISION_CELEX_SPARQL = '^6\\\\d{4}(CJ|CO|CC|CV|TJ|TO|TC)\\\\d+$';

export class IcuDataClient
implements LegalDataProvider<CaseLawReference>, CorpusEnumerationCapability<CaseLawReference> {
  constructor(
    private readonly http: Pick<AxiosInstance, 'get' | 'post'> = axios,
    private readonly converter: IcuConverter = new IcuConverter(),
    // Cellar serves Official-Journal-class XHTML, which is what EulConverter
    // already handles — the same publisher and the same markup, reached from a
    // different provider.
    private readonly cellarConverter: EulConverter = new EulConverter(),
  ) {}

  async searchCaseLaw(query: string, language = 'DE', limit = 10): Promise<{
    totalHits: number;
    hits: IcuSearchHit[];
  }> {
    const response = await this.request(() => safeAxiosPost<IcuSearchResponse>(
      this.http,
      SEARCH_URL,
      createSearchPayload(query, language, limit),
      ICU_SEARCH_POLICY,
      { headers: HEADERS, timeout: 30_000, maxContentLength: 10 * 1024 * 1024 },
    ));
    return {
      totalHits: response.data.totalHits ?? 0,
      hits: (response.data.searchHits ?? []).map(
        (hit: { content?: IcuSearchHit }) => hit.content ?? {},
      ),
    };
  }

  async getCaseLaw(caseId: string, language = 'DE'): Promise<{
    logicDocId: string;
    markdown: string;
  } | null> {
    const logicDocId = await this.resolveLogicDocId(caseId, language);
    if (!logicDocId) return null;
    const numericId = logicDocId.replace('id_', '');
    const response = await this.request(() => safeAxiosGet<string>(
      this.http,
      `${BLOB_URL}/${numericId}/${language.toUpperCase()}/html`,
      ICU_DOCUMENT_POLICY,
      {
        headers: { 'Origin': 'https://infocuria.curia.europa.eu' },
        responseType: 'text',
        timeout: 30_000,
        maxContentLength: 25 * 1024 * 1024,
      },
    ));
    return { logicDocId, markdown: this.converter.convert(response.data) };
  }

  async search(request: LegalSearchRequest): Promise<LegalSearchPage<CaseLawReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('case-law')) {
      return { results: [], failures: [] };
    }
    if (request.jurisdictions && !request.jurisdictions.some((id) => id.toUpperCase() === 'EU')) {
      return { results: [], failures: [] };
    }
    if (request.sourceIds && !request.sourceIds.includes('icu:infocuria')) {
      return { results: [], failures: [] };
    }
    const response = await this.searchCaseLaw(request.query, 'DE', request.limit ?? 10);
    return { results: response.hits.map(toReference), failures: [] };
  }

  async get(reference: CaseLawReference): Promise<LegalResourceDocument<CaseLawReference>> {
    assertReference(reference);
    const language = reference.language?.toUpperCase() ?? 'DE';
    const id = reference.provenance.providerDocumentId;

    // Enumeration yields CELEX-keyed references, and EUR-Lex serves those
    // directly — one request instead of the two the InfoCuria path needs
    // (search to resolve CELEX → logicDocId, then fetch). For a backfill of
    // tens of thousands of decisions that halves the traffic and keeps it off
    // a search API that was never meant for bulk.
    if (isCelex(id)) {
      const fetched = await this.getPublishedText(id, language);
      if (fetched) {
        return {
          // The language is what came back, not what was asked for. The Court
          // translates a case's title into every official language but not
          // always its text, so a reference enumerated from a German title can
          // still only be available in the case language.
          reference: fetched.language === reference.language
            ? reference
            : { ...reference, language: fetched.language },
          content: { format: 'markdown', value: fetched.markdown },
        };
      }
    }

    const result = await this.getCaseLaw(id, language);
    if (!result) throw new Error(`InfoCuria document ${id} not found.`);
    return {
      reference,
      content: { format: 'markdown', value: result.markdown },
    };
  }

  /**
   * The decision's text from Cellar, or `undefined` when Cellar has no real
   * text for it.
   *
   * Not every sector-6 CELEX resolves to a full document. Judgments do —
   * `62017CJ0476` returns 54k characters, `62018CJ0311` 186k — but for orders
   * published only as an Official Journal notice, Cellar serves the notice:
   * `62014TB0684` yields 427 characters that begin "Amtsblatt der Europäischen
   * Union". Returning that as the decision would silently replace a judgment
   * with its own announcement.
   *
   * The length test is deliberately generous. Its failure mode is falling back
   * to InfoCuria — exactly what this method exists to avoid, but never wrong —
   * so erring high costs one extra request and never costs correctness.
   */
  private async getPublishedText(
    celex: string,
    language: string,
  ): Promise<{ markdown: string; language: string } | undefined> {
    // The requested language first, then the fallback the Court publishes
    // everything in. Asking explicitly rather than by content negotiation is
    // what makes the answer's language knowable at all.
    const wanted = language.toUpperCase();
    for (const lang of wanted === 'EN' ? ['EN'] : [wanted, 'EN']) {
      const markdown = await this.fetchEurLexHtml(celex, lang);
      if (markdown) return { markdown, language: lang.toLowerCase() };
    }
    return undefined;
  }

  private async fetchEurLexHtml(celex: string, language: string): Promise<string | undefined> {
    try {
      const response = await safeAxiosGet<string>(
        this.http,
        `${EURLEX_HTML}/${language}/TXT/HTML/`,
        ICU_EURLEX_POLICY,
        {
          params: { uri: `CELEX:${celex}` },
          headers: { 'Accept': 'text/html, application/xhtml+xml' },
          maxRedirects: 5,
          timeout: 30_000,
          maxContentLength: 25 * 1024 * 1024,
          responseType: 'text',
        },
      );
      // Site chrome means EUR-Lex answered "not in this language" rather than
      // with the document, at HTTP 200.
      if (typeof response.data !== 'string' || response.data.includes(EURLEX_CHROME_MARKER)) {
        return undefined;
      }
      const markdown = this.cellarConverter.convert(response.data);
      return markdown.trim().length >= PUBLISHED_TEXT_MIN_CHARS ? markdown : undefined;
    } catch {
      // A language or a document EUR-Lex does not hold is ordinary here.
      return undefined;
    }
  }

  /**
   * Walk CJEU case law from Cellar — a different backend than `search`, which
   * queries InfoCuria. InfoCuria has no walkable listing; Cellar holds the same
   * decisions as CELEX sector 6 and filters by date server-side, so `origin` is
   * `native`.
   *
   * Cost note for bulk callers: the reference this yields is keyed by CELEX,
   * and `get` resolves CELEX to InfoCuria's internal id with one extra search
   * request per document. Fetching the text from Cellar directly would halve
   * that; it is not done here because it would change what `get` returns for
   * every existing caller.
   */
  async enumerate(request: CorpusEnumerationRequest = {}): Promise<CorpusEnumerationPage<CaseLawReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('case-law')) {
      return { results: [], failures: [], origin: 'native' };
    }
    if (request.jurisdictions && !request.jurisdictions.some((id) => id.toUpperCase() === 'EU')) {
      return { results: [], failures: [], origin: 'native' };
    }
    const limit = Math.min(Math.max(1, request.limit ?? DEFAULT_ENUMERATION_LIMIT), MAX_ENUMERATION_LIMIT);
    const language = 'DEU';
    const sinceFilter = request.since
      ? `FILTER(?d >= "${isoDateLiteral(request.since)}"^^xsd:date)`
      : '';
    const keyset = request.cursor
      ? `FILTER(STR(?celex) > ${sparqlStringLiteral(request.cursor)})`
      : '';
    // Grouped, not DISTINCT. `SELECT DISTINCT` is distinct over the whole
    // tuple, so a work carrying two titles or two ECLIs emitted the same CELEX
    // more than once — observed live, 62020TJ0510 twice inside one page of
    // ten. Duplicates waste a fetch each and make `limit` mean less than it
    // says. Grouping on ?celex guarantees one row per document.
    const sparql = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?celex (SAMPLE(?t) AS ?title) (MIN(?d) AS ?date) (SAMPLE(?e) AS ?ecli) WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  ?work cdm:work_date_document ?d .
  OPTIONAL { ?work cdm:case-law_ecli ?e }
  ?expr cdm:expression_belongs_to_work ?work .
  ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${language}> .
  ?expr cdm:expression_title ?t .
  ${sinceFilter}
  ${keyset}
  FILTER(REGEX(STR(?celex), "${DECISION_CELEX_SPARQL}"))
} GROUP BY ?celex ORDER BY ?celex LIMIT ${limit}`;

    const response = await this.request(() => safeAxiosGet<SparqlResponse>(
      this.http,
      SPARQL_URL,
      ICU_SPARQL_POLICY,
      {
      params: { query: sparql },
      headers: { 'Accept': 'application/sparql-results+json' },
      timeout: 30_000,
      maxContentLength: 10 * 1024 * 1024,
      },
    ));
    const bindings: Record<string, { value?: string }>[] = response.data.results?.bindings ?? [];
    const results = bindings.map((binding): CaseLawReference => {
      const celex = binding.celex?.value ?? '';
      const ecli = binding.ecli?.value;
      return {
        resourceType: 'case-law',
        title: binding.title?.value || ecli || celex,
        jurisdiction: 'EU',
        language: 'de',
        ...(binding.date?.value ? { decisionDate: binding.date.value } : {}),
        ...(ecli ? { ecli } : {}),
        provenance: {
          providerId: 'icu',
          sourceId: 'icu:infocuria',
          providerDocumentId: celex,
          canonicalUrl: `https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:${celex}`,
        },
        rights: RIGHTS,
      };
    });
    const last = results.at(-1);
    return {
      results,
      failures: [],
      ...(results.length === limit && last
        ? { nextCursor: last.provenance.providerDocumentId }
        : {}),
      origin: 'native',
    };
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw classifyIcuError(error);
    }
  }

  private async resolveLogicDocId(caseId: string, language: string): Promise<string | null> {
    if (caseId.startsWith('id_')) return caseId;
    if (/^\d+$/.test(caseId)) return `id_${caseId}`;

    if (isCelex(caseId)) return this.searchLogicDocId(caseId, language);

    // A bare published case number ("C-476/17") cannot be looked up directly:
    // InfoCuria has no exact case-number filter, so the `publishedId` field it
    // was passed in is simply ignored and the search returns nothing (or, as
    // free text, hundreds of loosely related hits with the wrong case first).
    // The CELEX number is a deterministic transform of it, and searching for
    // that works — so convert and use the path that does.
    for (const candidate of celexCandidates(caseId)) {
      const found = await this.searchLogicDocId(candidate, language);
      if (found) return found;
    }
    return null;
  }

  private async searchLogicDocId(celex: string, language: string): Promise<string | null> {
    const body = createSearchPayload(celex, language, 1);
    const response = await this.request(() => safeAxiosPost<IcuSearchResponse>(
      this.http,
      SEARCH_URL,
      body,
      ICU_SEARCH_POLICY,
      { headers: HEADERS, timeout: 30_000, maxContentLength: 10 * 1024 * 1024 },
    ));
    return response.data.searchHits?.[0]?.content?.logicDocId ?? null;
  }
}

function isCelex(value: string): boolean {
  return /^\d{5}[A-Z]{2}\d+$/.test(value);
}

/**
 * Build the complete payload expected by the current InfoCuria frontend.
 *
 * The endpoint accepts older partial payloads with HTTP 200 but silently
 * ignores `searchTerm`, returning the newest corpus entries. Keeping the
 * frontend's structural fields here is therefore correctness-critical, not
 * cosmetic. Published case numbers also need their dedicated filter; a plain
 * `searchTerm: "C-311/18"` currently returns thousands of unrelated hits.
 */
export function createSearchPayload(
  rawQuery: string,
  language: string,
  limit: number,
): Record<string, unknown> {
  const query = rawQuery.trim();
  const normalizedLanguage = language.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalizedLanguage)) {
    throw new Error(`Invalid InfoCuria language: ${language}`);
  }
  const normalizedLimit = Number.isFinite(limit)
    ? Math.min(Math.max(1, Math.trunc(limit)), 100)
    : 10;
  const publishedId = /^(?:C|T|F)[-_–‑\s]?\d+\/\d{2,4}(?:\s+P)?$/i.test(query)
    ? query.toUpperCase().replace(/[_–‑\s]/, '-')
    : '';
  const ecli = /^ECLI:/i.test(query) ? query.toUpperCase() : '';
  const logicDocId = /^id_\d+$/i.test(query) ? query.toLowerCase() : '';
  const exactIdentifier = publishedId || ecli || logicDocId;

  return {
    searchTerm: exactIdentifier ? `"${query}"` : query,
    multiSearchTerms: [],
    sortTermList: [{ sortDirection: 'DESC', sortTerm: 'SCORE' }],
    pagination: {
      pageNumber: 0,
      pageSize: normalizedLimit,
      from: 1,
      to: normalizedLimit * 2,
    },
    language: normalizedLanguage,
    tabName: 'tout_jurisprudence',
    isAllTabsRequest: false,
    isSearchExact: true,
    searchSources: ['document', 'metadata'],
    ecli,
    publishedId,
    usualName: '',
    logicDocId,
    repJurExpand: '',
    filtersValue: [],
    advancedFiltersValue: [],
  };
}

/**
 * Build CELEX candidates for a published CJEU case number.
 *
 * CELEX case-law ids are `6` + four-digit year + a two-letter document code +
 * the case number padded to four digits. Verified against live InfoCuria data:
 *
 *   C-476/17  → 62017CJ0476        T-108/25  → 62025TJ0108
 *   C-797/23  → 62023CJ0797
 *
 * The court comes from the prefix (C = Court of Justice, T = General Court), but
 * the document code also encodes judgment vs. order, which the case number does
 * not reveal — so both are returned, judgments first as the common case.
 */
export function celexCandidates(caseId: string): string[] {
  const match = caseId
    .trim()
    .toUpperCase()
    .match(/^(C|T|F)[-\s]?(\d+)\/(\d{2,4})$/);
  if (!match) return [];

  const [, prefix, rawNumber, rawYear] = match;
  if (!prefix || !rawNumber || !rawYear) return [];

  // Two-digit years: InfoCuria's case numbering starts in 1953, so anything
  // below 54 belongs to the 2000s.
  const year = rawYear.length === 4
    ? Number(rawYear)
    : Number(rawYear) < 54 ? 2000 + Number(rawYear) : 1900 + Number(rawYear);
  const number = rawNumber.padStart(4, '0');
  const codes = prefix === 'C' ? ['CJ', 'CO'] : prefix === 'T' ? ['TJ', 'TO'] : ['FJ', 'FO'];

  return codes.map((code) => `6${year}${code}${number}`);
}

function toReference(hit: IcuSearchHit): CaseLawReference {
  const title = [hit.docType, hit.idPublished].filter(Boolean).join(' – ')
    || hit.ecli
    || hit.logicDocId
    || 'InfoCuria decision';
  const canonicalUrl = canonicalUrlFor(hit);
  return {
    resourceType: 'case-law',
    title,
    jurisdiction: 'EU',
    language: 'de',
    ...(hit.docDate ? { decisionDate: hit.docDate } : {}),
    ...(hit.affairJurisdiction ? { court: hit.affairJurisdiction } : {}),
    ...(hit.idPublished ? { fileNumber: hit.idPublished } : {}),
    ...(hit.ecli ? { ecli: hit.ecli } : {}),
    provenance: {
      providerId: 'icu',
      sourceId: 'icu:infocuria',
      // CELEX is the durable public identifier and enables the Cellar fast
      // path. InfoCuria's internal blob ids can temporarily return 404 while a
      // newly indexed document is still being published.
      providerDocumentId: hit.celex ?? hit.logicDocId ?? hit.idPublished ?? '',
      ...(canonicalUrl ? { canonicalUrl } : {}),
    },
    rights: RIGHTS,
  };
}

/**
 * Not every InfoCuria hit carries a CELEX id (orders and some undocketed
 * decisions don't), so fall back to EUR-Lex's ECLI lookup, which resolves to
 * the same document text. Both forms were verified to return the full
 * decision.
 *
 * Deliberately no `curia.europa.eu/juris/...` fallback: those URLs answer 200
 * but serve only a JavaScript shell (no document text), so they would hand
 * consumers a dead link that merely looks authoritative. Returning nothing is
 * more honest — `canonicalUrl` is optional in the contract for exactly this
 * case.
 */
function canonicalUrlFor(hit: IcuSearchHit): string | undefined {
  if (hit.celex) {
    return `https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:${hit.celex}`;
  }
  if (hit.ecli) {
    return `https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=ecli:${hit.ecli}`;
  }
  return undefined;
}

function assertReference(reference: CaseLawReference): void {
  if (reference.provenance.providerId !== 'icu') {
    throw new Error(`Reference does not belong to icu: ${reference.provenance.providerId}`);
  }
}
