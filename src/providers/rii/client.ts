import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type {
  CaseLawReference,
  LegalDataProvider,
  LegalResourceDocument,
  LegalResourceRights,
  LegalSearchPage,
  LegalSearchRequest,
} from '../../contracts/legal-resource.js';
import type {
  CorpusEnumerationCapability,
  CorpusEnumerationPage,
  CorpusEnumerationRequest,
} from '../../contracts/provider-capabilities.js';
import { invalidateAllSessions } from '../../shared/clients/jportal.js';
import {
  decodeEnumerationCursor as decodeCursor,
  encodeEnumerationCursor as encodeCursor,
} from '../../shared/enumeration.js';
import { RiiConverter } from './converter.js';
import { BayernDecisionAdapter } from './adapters/bayern.js';
import { BrandenburgDecisionAdapter } from './adapters/brandenburg.js';
import { BremenDecisionAdapter } from './adapters/bremen.js';
import { FederalDecisionAdapter } from './adapters/federal.js';
import { JPortalDecisionAdapter } from './adapters/jportal.js';
import { NiedersachsenDecisionAdapter } from './adapters/niedersachsen.js';
import { NRWDecisionAdapter } from './adapters/nrw.js';
import { SachsenDecisionAdapter } from './adapters/sachsen.js';
import type {
  DecisionAdapter,
  DecisionEntry,
  DecisionGetOptions,
  DecisionSearchBatch,
  DecisionSearchResult,
  SourcedDecisionSearchResult,
} from './types.js';

export const GERMAN_CASE_LAW_PROVIDER_ID = 'de-case-law';

export const PUBLIC_CASE_LAW_RIGHTS = {
  access: 'public',
  fullTextStorage: 'allowed',
  redistribution: 'unknown',
  licence: 'NOASSERTION',
} as const satisfies LegalResourceRights;

export interface CaseLawSearchOptions {
  sources?: readonly string[] | 'ALL';
  limit?: number;
  limitPerSource?: number;
  /** 1-based. Each source is asked for its own page N, then results are pooled. */
  page?: number;
}

export interface CaseLawClientConfiguration {
  readonly providerId: string;
  readonly language: string;
  readonly locale: string;
  readonly rights: LegalResourceRights;
  readonly jurisdictionForSource: (source: string) => string | undefined;
  readonly sourceForJurisdiction: (jurisdiction: string) => string | undefined;
  readonly shutdown?: () => void;
}

export function createGermanDecisionAdapters(
  http: Pick<AxiosInstance, 'get' | 'post'> = axios,
  converter: RiiConverter = new RiiConverter(),
): readonly DecisionAdapter[] {
  return [
    new FederalDecisionAdapter(http, converter),
    new BayernDecisionAdapter(),
    new NRWDecisionAdapter(http),
    new JPortalDecisionAdapter(),
    new NiedersachsenDecisionAdapter(http),
    new BrandenburgDecisionAdapter(http),
    new BremenDecisionAdapter(http),
    new SachsenDecisionAdapter(http),
  ];
}

export const GERMAN_CASE_LAW_CONFIGURATION: CaseLawClientConfiguration = {
  providerId: GERMAN_CASE_LAW_PROVIDER_ID,
  language: 'de',
  locale: 'de-DE',
  rights: PUBLIC_CASE_LAW_RIGHTS,
  jurisdictionForSource: (source) => source === 'BUND' ? 'DE' : `DE-${source}`,
  sourceForJurisdiction: (jurisdiction) => {
    const normalized = jurisdiction.toUpperCase();
    if (normalized === 'DE') return 'BUND';
    return normalized.startsWith('DE-') ? normalized.slice(3) : undefined;
  },
  shutdown: invalidateAllSessions,
};

export class CaseLawClient
implements LegalDataProvider<CaseLawReference>, CorpusEnumerationCapability<CaseLawReference> {
  private readonly adapters: readonly DecisionAdapter[];
  private readonly adapterBySource = new Map<string, DecisionAdapter>();

  constructor(
    adapters: readonly DecisionAdapter[] = createGermanDecisionAdapters(),
    private readonly configuration: CaseLawClientConfiguration = GERMAN_CASE_LAW_CONFIGURATION,
  ) {
    this.adapters = adapters;
    for (const adapter of adapters) {
      for (const source of adapter.sources) {
        if (this.adapterBySource.has(source)) {
          throw new Error(`Duplicate case-law source: ${source}`);
        }
        this.adapterBySource.set(source, adapter);
      }
    }
  }

  get sources(): readonly string[] {
    return [...this.adapterBySource.keys()];
  }

  async searchDecisions(
    query: string,
    options: CaseLawSearchOptions = {},
  ): Promise<DecisionSearchBatch> {
    const limit = Math.max(1, options.limit ?? 10);
    const page = Math.max(1, options.page ?? 1);
    const limitPerSource = Math.max(1, options.limitPerSource ?? limit);
    const sources = options.sources === undefined || options.sources === 'ALL'
      ? this.sources
      : options.sources;

    const searches = sources.map(async (source) => {
      const adapter = this.adapterBySource.get(source);
      if (!adapter) throw new Error(`Unknown case-law source: ${source}`);
      // Prefer the paged call so a source that publishes its own total gets to
      // report it; adapters without one fall back to the plain search.
      const fetched = adapter.searchPage
        ? await adapter.searchPage(source, query, limitPerSource, page)
        : { results: page === 1 ? await adapter.search(source, query, limitPerSource) : [], pagingUnsupported: page > 1 };
      return { source, ...fetched };
    });
    const settled = await Promise.allSettled(searches);
    const successful = settled.filter((item): item is PromiseFulfilledResult<{
      source: string;
      results: DecisionSearchResult[];
      totalHits?: number;
      pagingUnsupported?: boolean;
    }> => item.status === 'fulfilled');
    const totals: Record<string, number> = {};
    const unpaged: string[] = [];
    for (const { value } of successful) {
      if (value.totalHits !== undefined) totals[value.source] = value.totalHits;
      if (value.pagingUnsupported) unpaged.push(value.source);
    }
    const queryTerms = query
      .toLocaleLowerCase(this.configuration.locale)
      .split(/\s+/)
      .filter((term) => term.length > 1);
    const seen = new Set<string>();

    const results = successful
      .flatMap(({ value }) => value.results.map((result): SourcedDecisionSearchResult => ({
        ...result,
        source: value.source,
      })))
      .filter((result) => {
        const key = (
          result.ecli
          || (result.court && result.fileNumber
            ? `${result.court}|${result.fileNumber}`
            : `${result.title}|${result.date}`)
        ).toLocaleLowerCase(this.configuration.locale);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const byScore = this.searchScore(b, queryTerms) - this.searchScore(a, queryTerms);
        if (byScore !== 0) return byScore;
        // searchScore only counts how many distinct query terms appear, so a
        // single-term query scores every hit identically. Without a tie-break the
        // stable sort then preserves adapter registration order, and the
        // first-registered source takes every slot — the federal adapter returned
        // all 25 of a 30-result "Schadensersatz" search that way, burying sixteen
        // state portals that had matches. Recency is the defensible default for
        // case law and is parsed by nearly every source.
        return sortableDate(b.date).localeCompare(sortableDate(a.date));
      });

    return {
      results: allocateFairly(results, limit),
      ...(Object.keys(totals).length > 0 ? { totals } : {}),
      ...(unpaged.length > 0 ? { unpaged } : {}),
      failures: settled.flatMap((result, index) => result.status === 'rejected'
        ? [{ source: sources[index] ?? 'unknown', error: result.reason }]
        : []),
    };
  }

  async getDecision(
    source: string,
    id: string,
    options: DecisionGetOptions = {},
  ): Promise<DecisionEntry> {
    const adapter = this.adapterBySource.get(source);
    if (!adapter) throw new Error(`Unknown case-law source: ${source}`);
    return adapter.get(source, id, options);
  }

  async search(request: LegalSearchRequest): Promise<LegalSearchPage<CaseLawReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('case-law')) {
      return { results: [], failures: [] };
    }
    const requestedSources = this.resolveSources(request.sourceIds, request.jurisdictions);
    const batch = await this.searchDecisions(request.query, {
      ...(requestedSources ? { sources: requestedSources } : {}),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
    return {
      results: batch.results.map((result) => this.toReference(result)),
      failures: batch.failures.map((failure) => ({
        sourceId: this.sourceId(failure.source),
        message: failure.error instanceof Error ? failure.error.message : String(failure.error),
        cause: failure.error,
      })),
    };
  }

  /**
   * Walk the enumerable sources, one at a time, resuming from `cursor`.
   *
   * Sequential rather than interleaved: each portal is a separate operator's
   * server, and one walk at a time is the polite shape. Sources whose adapter
   * cannot enumerate are reported as failures on the first page of a walk —
   * once, not on every page — so a caller sees that coverage is partial
   * without the notice repeating for the length of the corpus.
   */
  async enumerate(
    request: CorpusEnumerationRequest = {},
  ): Promise<CorpusEnumerationPage<CaseLawReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('case-law')) {
      return { results: [], failures: [], origin: 'native' };
    }
    const requested = this.resolveSources(request.sourceIds, request.jurisdictions) ?? this.sources;
    const enumerable = requested.filter((source) => this.adapterBySource.get(source)?.enumerate);
    const resumed = request.cursor ? decodeCursor(request.cursor) : undefined;
    if (request.cursor && !resumed) {
      throw new Error('Malformed enumeration cursor.');
    }
    // Unsupported sources are only worth stating when a walk begins; repeating
    // them on every page would bury the real failures.
    const failures = resumed ? [] : requested
      .filter((source) => !enumerable.includes(source))
      .map((source) => ({
        sourceId: this.sourceId(source),
        message: `Source ${source} does not support enumeration; its portal exposes no walkable listing.`,
      }));

    const startAt = resumed ? enumerable.indexOf(resumed.source) : 0;
    if (startAt < 0) throw new Error(`Enumeration cursor names an unknown source: ${resumed?.source}`);

    for (let index = startAt; index < enumerable.length; index++) {
      const source = enumerable[index];
      if (source === undefined) continue;
      const adapter = this.adapterBySource.get(source);
      if (!adapter?.enumerate) continue;
      const page = await adapter.enumerate(source, {
        ...(request.since ? { since: request.since } : {}),
        ...(index === startAt && resumed?.cursor ? { cursor: resumed.cursor } : {}),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      const next = page.nextCursor
        ? encodeCursor({ source, cursor: page.nextCursor })
        : enumerable[index + 1] !== undefined
          ? encodeCursor({ source: enumerable[index + 1] as string })
          : undefined;
      // An exhausted source that yielded nothing must not end the walk while
      // later sources are still untouched.
      if (page.results.length === 0 && next !== undefined) continue;
      return {
        results: page.results.map((result) => this.toReference({ ...result, source })),
        failures,
        ...(next ? { nextCursor: next } : {}),
        origin: page.origin,
      };
    }
    return { results: [], failures, origin: 'native' };
  }

  async get(reference: CaseLawReference): Promise<LegalResourceDocument<CaseLawReference>> {
    const source = this.sourceFromReference(reference);
    const entry = await this.getDecision(source, reference.provenance.providerDocumentId);
    // Fields a source publishes as tagged data rather than prose. Only the
    // archive route supplies them, so they are merged onto the reference here
    // instead of being threaded through the search-shaped `toReference`.
    const published = {
      ...(entry.chamber ? { chamber: entry.chamber } : {}),
      ...(entry.documentType ? { documentType: entry.documentType } : {}),
      ...(entry.norms?.length ? { citedNorms: entry.norms } : {}),
      ...(entry.priorInstances?.length ? { priorInstances: entry.priorInstances } : {}),
    };
    return {
      reference: this.mergePublished(this.toReference({
        source,
        id: reference.provenance.providerDocumentId,
        title: entry.title || reference.title,
        subtitle: '',
        date: entry.date || reference.decisionDate || '',
        court: entry.court || reference.court || '',
        fileNumber: entry.fileNumber || reference.fileNumber || '',
        ...((entry.ecli || reference.ecli)
          ? { ecli: entry.ecli || reference.ecli }
          : {}),
        ...((entry.url || reference.provenance.canonicalUrl)
          ? { url: entry.url || reference.provenance.canonicalUrl }
          : {}),
      }), published),
      content: { format: 'markdown', value: entry.content },
    };
  }

  private mergePublished(
    reference: CaseLawReference,
    published: Partial<CaseLawReference>,
  ): CaseLawReference {
    return Object.keys(published).length > 0 ? { ...reference, ...published } : reference;
  }

  shutdown(): void {
    this.configuration.shutdown?.();
  }

  private toReference(result: SourcedDecisionSearchResult): CaseLawReference {
    const jurisdiction = this.configuration.jurisdictionForSource(result.source);
    return {
      resourceType: 'case-law',
      title: result.title,
      ...(jurisdiction ? { jurisdiction } : {}),
      language: this.configuration.language,
      ...(result.date ? { decisionDate: result.date } : {}),
      ...(result.court ? { court: result.court } : {}),
      ...(result.fileNumber ? { fileNumber: result.fileNumber } : {}),
      ...(result.ecli ? { ecli: result.ecli } : {}),
      provenance: {
        providerId: this.configuration.providerId,
        sourceId: this.sourceId(result.source),
        providerDocumentId: result.id,
        ...(result.url ? { canonicalUrl: result.url } : {}),
      },
      rights: this.configuration.rights,
    };
  }

  /**
   * Court and file number are scored alongside the free text. Without them a
   * query like "Landesarbeitsgericht Kündigung" only matches on the second
   * term, because every adapter that resolves the court into its own field
   * rather than into the title kept it out of the scored text entirely.
   */
  private searchScore(
    result: Pick<DecisionSearchResult, 'title' | 'subtitle' | 'snippet' | 'court' | 'fileNumber'>,
    terms: readonly string[],
  ): number {
    const text = [result.title, result.subtitle, result.snippet, result.court, result.fileNumber]
      .filter((part): part is string => part !== undefined && part !== '')
      .join(' ')
      .toLocaleLowerCase(this.configuration.locale);
    return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
  }

  /**
   * Narrow the walk or the search to the sources a request asks for, by
   * explicit id or by jurisdiction. `undefined` means "no restriction stated".
   */
  private resolveSources(
    sourceIds?: readonly string[],
    jurisdictions?: readonly string[],
  ): string[] | undefined {
    const prefix = `${this.configuration.providerId}:`;
    let sources = sourceIds?.map((id) => id.startsWith(prefix) ? id.slice(prefix.length) : id);
    if (jurisdictions) {
      const fromJurisdictions = jurisdictions
        .map(this.configuration.sourceForJurisdiction)
        .filter((source): source is string =>
          source !== undefined && this.adapterBySource.has(source)
        );
      sources = sources
        ? sources.filter((source) => fromJurisdictions.includes(source))
        : fromJurisdictions;
    }
    return sources;
  }

  private sourceId(source: string): string {
    return `${this.configuration.providerId}:${source}`;
  }

  private sourceFromReference(reference: CaseLawReference): string {
    const prefix = `${this.configuration.providerId}:`;
    if (!reference.provenance.sourceId.startsWith(prefix)) {
      throw new Error(
        `Reference source "${reference.provenance.sourceId}" does not belong to ${this.configuration.providerId}.`,
      );
    }
    return reference.provenance.sourceId.slice(prefix.length);
  }
}

/**
 * `DD.MM.YYYY` and `YYYY-MM-DD` both occur across the seventeen sources. Normalize
 * to a lexicographically sortable form; anything unparseable sorts last rather
 * than winning by accident.
 */
function sortableDate(date: string): string {
  const german = date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (german) return `${german[3]}-${german[2]}-${german[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : '';
}

/**
 * Fill `limit` slots by taking from each source in turn, so a single prolific
 * source cannot consume the whole page.
 *
 * Ranking still decides the order *within* a source, and the interleave walks
 * sources in descending order of their best-ranked hit, so the top result overall
 * is preserved. Only the tail changes: instead of 25 federal decisions, a
 * consolidated search returns the strongest few from each portal that matched.
 */
function allocateFairly(
  ranked: readonly SourcedDecisionSearchResult[],
  limit: number,
): SourcedDecisionSearchResult[] {
  const bySource = new Map<string, SourcedDecisionSearchResult[]>();
  for (const result of ranked) {
    const bucket = bySource.get(result.source);
    if (bucket) bucket.push(result);
    else bySource.set(result.source, [result]);
  }

  // Map iteration follows insertion order, which here is descending rank of each
  // source's best hit — so round one emits the overall winner first.
  const queues = [...bySource.values()];
  const allocated: SourcedDecisionSearchResult[] = [];
  for (let round = 0; allocated.length < limit; round++) {
    let progressed = false;
    for (const queue of queues) {
      const next = queue[round];
      if (next === undefined) continue;
      allocated.push(next);
      progressed = true;
      if (allocated.length === limit) return allocated;
    }
    if (!progressed) break;
  }
  return allocated;
}
