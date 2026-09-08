import type {
  LegalDataProvider,
  LegalResourceDocument,
  LegalResourceRights,
  LegalSearchPage,
  LegalSearchRequest,
  LegislationReference,
} from '../../contracts/legal-resource.js';
import type {
  CorpusEnumerationCapability,
  CorpusEnumerationPage,
  CorpusEnumerationRequest,
  LegalTableOfContents,
  TableOfContentsCapability,
} from '../../contracts/provider-capabilities.js';
import { invalidateAllSessions } from '../../shared/clients/jportal.js';
import {
  decodeEnumerationCursor as decodeCursor,
  encodeEnumerationCursor as encodeCursor,
} from '../../shared/enumeration.js';
import { BayernAdapter } from './adapters/bayern.js';
import { BrandenburgAdapter } from './adapters/brandenburg.js';
import { BremenAdapter } from './adapters/bremen.js';
import { GiiAdapter } from './adapters/gii.js';
import { JPortalAdapter } from './adapters/jportal.js';
import { NiedersachsenAdapter } from './adapters/niedersachsen.js';
import { NRWAdapter } from './adapters/nrw.js';
import { SachsenAdapter } from './adapters/sachsen.js';
import type {
  LegisAdapter,
  LegisEntry,
  SearchResult,
  TocEntry,
} from './types.js';

export const GERMAN_LEGISLATION_PROVIDER_ID = 'de-legislation';

export const PUBLIC_LEGISLATION_RIGHTS = {
  access: 'public',
  fullTextStorage: 'allowed',
  redistribution: 'unknown',
  licence: 'NOASSERTION',
} as const satisfies LegalResourceRights;

export interface LegislationSearchOptions {
  readonly sources?: readonly string[] | 'ALL';
  readonly limit?: number;
  readonly limitPerSource?: number;
}

export interface LegislationClientConfiguration {
  readonly providerId: string;
  readonly language: string;
  readonly locale: string;
  readonly rights: LegalResourceRights;
  readonly jurisdictionForSource: (source: string) => string | undefined;
  readonly sourceForJurisdiction: (jurisdiction: string) => string | undefined;
  readonly isSearchableSource?: (source: string) => boolean;
  readonly shutdown?: () => void;
}

export interface SourcedLegislationSearchResult extends SearchResult {
  readonly source: string;
}

export interface LegislationSourceFailure {
  readonly source: string;
  readonly error: unknown;
}

export interface LegislationSearchBatch {
  readonly results: readonly SourcedLegislationSearchResult[];
  readonly failures: readonly LegislationSourceFailure[];
}

export function createGermanLegislationAdapters(): readonly LegisAdapter[] {
  return [
    new GiiAdapter(),
    new JPortalAdapter(),
    new NiedersachsenAdapter(),
    new BayernAdapter(),
    new BrandenburgAdapter(),
    new SachsenAdapter(),
    new BremenAdapter(),
    new NRWAdapter(),
  ];
}

export const GERMAN_LEGISLATION_CONFIGURATION: LegislationClientConfiguration = {
  providerId: GERMAN_LEGISLATION_PROVIDER_ID,
  language: 'de',
  locale: 'de-DE',
  rights: PUBLIC_LEGISLATION_RIGHTS,
  jurisdictionForSource: (source) => source === 'BUND' ? 'DE' : `DE-${source}`,
  sourceForJurisdiction: (jurisdiction) => {
    const normalized = jurisdiction.toUpperCase();
    if (normalized === 'DE') return 'BUND';
    return normalized.startsWith('DE-') ? normalized.slice(3) : undefined;
  },
  isSearchableSource: (source) => source !== 'BUND',
  shutdown: invalidateAllSessions,
};

export class LegislationClient implements
  LegalDataProvider<LegislationReference>,
  TableOfContentsCapability<LegislationReference>,
  CorpusEnumerationCapability<LegislationReference> {
  private readonly adapterBySource = new Map<string, LegisAdapter>();

  constructor(
    adapters: readonly LegisAdapter[] = createGermanLegislationAdapters(),
    private readonly configuration: LegislationClientConfiguration =
      GERMAN_LEGISLATION_CONFIGURATION,
  ) {
    for (const adapter of adapters) {
      for (const source of adapter.states) {
        if (this.adapterBySource.has(source)) {
          throw new Error(`Duplicate legislation source: ${source}`);
        }
        this.adapterBySource.set(source, adapter);
      }
    }
  }

  get sources(): readonly string[] {
    return [...this.adapterBySource.keys()];
  }

  get searchableSources(): readonly string[] {
    return this.sources.filter((source) =>
      this.configuration.isSearchableSource?.(source) ?? true
    );
  }

  async searchLegislation(
    query: string,
    options: LegislationSearchOptions = {},
  ): Promise<LegislationSearchBatch> {
    const limit = Math.max(1, options.limit ?? 10);
    const limitPerSource = Math.max(1, options.limitPerSource ?? limit);
    const sources = options.sources === undefined || options.sources === 'ALL'
      ? this.searchableSources
      : options.sources;
    const searches = sources.map(async (source) => {
      const adapter = this.getAdapter(source);
      return {
        source,
        results: await adapter.search(source, query, limitPerSource),
      };
    });
    const settled = await Promise.allSettled(searches);
    const successful = settled.filter((result): result is PromiseFulfilledResult<{
      source: string;
      results: SearchResult[];
    }> => result.status === 'fulfilled');
    const terms = query
      .toLocaleLowerCase(this.configuration.locale)
      .split(/\s+/)
      .filter((term) => term.length > 1);
    const seen = new Set<string>();
    const results = successful
      .flatMap(({ value }) => value.results.map((result) => ({
        ...result,
        source: value.source,
      })))
      .filter((result) => {
        const key = `${result.source}:${result.id}`.toLocaleLowerCase(
          this.configuration.locale,
        );
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => this.searchScore(right, terms) - this.searchScore(left, terms))
      .slice(0, limit);

    return {
      results,
      failures: settled.flatMap((result, index) => result.status === 'rejected'
        ? [{ source: sources[index] ?? 'unknown', error: result.reason }]
        : []),
    };
  }

  async getLegislation(source: string, id: string): Promise<LegisEntry> {
    return this.getAdapter(source).get(source, id);
  }

  getTableOfContents(reference: LegislationReference): Promise<LegalTableOfContents<LegislationReference>>;
  getTableOfContents(source: string, id: string): Promise<TocEntry[]>;
  async getTableOfContents(
    referenceOrSource: LegislationReference | string,
    id?: string,
  ): Promise<LegalTableOfContents<LegislationReference> | TocEntry[]> {
    if (typeof referenceOrSource === 'string') {
      if (!id) throw new Error('A legislation document id is required.');
      return this.getRawTableOfContents(referenceOrSource, id).then(({ entries }) => entries);
    }
    const source = this.sourceFromReference(referenceOrSource);
    const result = await this.getRawTableOfContents(
      source,
      referenceOrSource.provenance.providerDocumentId,
    );
    return {
      reference: referenceOrSource,
      origin: result.origin,
      entries: result.entries.map((entry, index) => ({
        id: entry.num || `heading-${index + 1}`,
        title: entry.title || entry.num,
        ...(entry.num ? { label: entry.num } : {}),
        level: entry.depth,
      })),
    };
  }

  private async getRawTableOfContents(
    source: string,
    id: string,
  ): Promise<{ entries: TocEntry[]; origin: 'native' | 'derived' }> {
    const adapter = this.getAdapter(source);
    if (adapter.toc) {
      return { entries: await adapter.toc(source, id), origin: 'native' };
    }
    const entry = await adapter.get(source, id);
    return {
      entries: this.extractTableOfContents(entry.content),
      origin: 'derived',
    };
  }

  async search(
    request: LegalSearchRequest,
  ): Promise<LegalSearchPage<LegislationReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('legislation')) {
      return { results: [], failures: [] };
    }
    const requestedSources = this.resolveSources(request.sourceIds, request.jurisdictions)
      ?.filter((source) => this.configuration.isSearchableSource?.(source) ?? true);
    const batch = await this.searchLegislation(request.query, {
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

  async get(
    reference: LegislationReference,
  ): Promise<LegalResourceDocument<LegislationReference>> {
    const source = this.sourceFromReference(reference);
    const entry = await this.getLegislation(
      source,
      reference.provenance.providerDocumentId,
    );
    return {
      reference: this.toReference({
        source,
        id: reference.provenance.providerDocumentId,
        title: entry.title,
        subtitle: '',
        date: reference.publicationDate ?? '',
        url: entry.url,
      }),
      content: { format: 'markdown', value: entry.content },
    };
  }

  shutdown(): void {
    this.configuration.shutdown?.();
  }

  private getAdapter(source: string): LegisAdapter {
    const adapter = this.adapterBySource.get(source);
    if (!adapter) {
      throw new Error(
        `Legislation source "${source}" is not yet supported.`,
      );
    }
    return adapter;
  }

  private toReference(result: SourcedLegislationSearchResult): LegislationReference {
    const jurisdiction = this.configuration.jurisdictionForSource(result.source);
    return {
      resourceType: 'legislation',
      title: result.title,
      ...(jurisdiction ? { jurisdiction } : {}),
      language: this.configuration.language,
      ...(result.date ? { publicationDate: result.date } : {}),
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
   * Narrow to the sources a request names, by id or jurisdiction. Deliberately
   * does not apply `isSearchableSource` — that filter belongs to `search`, and
   * applying it here would exclude the one source that can be walked: GII is
   * search-less and enumerable, exactly the inverse of the Länder portals.
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

  /**
   * Walk the enumerable sources in turn. See `CaseLawClient.enumerate` — the
   * shape is deliberately identical, so an ingest loop drives both providers
   * through one code path.
   */
  async enumerate(
    request: CorpusEnumerationRequest = {},
  ): Promise<CorpusEnumerationPage<LegislationReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('legislation')) {
      return { results: [], failures: [], origin: 'native' };
    }
    const requested = this.resolveSources(request.sourceIds, request.jurisdictions) ?? this.sources;
    const enumerable = requested.filter((source) => this.adapterBySource.get(source)?.enumerate);
    const resumed = request.cursor ? decodeCursor(request.cursor) : undefined;
    if (request.cursor && !resumed) throw new Error('Malformed enumeration cursor.');

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

  private sourceId(source: string): string {
    return `${this.configuration.providerId}:${source}`;
  }

  private sourceFromReference(reference: LegislationReference): string {
    const prefix = `${this.configuration.providerId}:`;
    if (!reference.provenance.sourceId.startsWith(prefix)) {
      throw new Error(
        `Reference source "${reference.provenance.sourceId}" does not belong to ${this.configuration.providerId}.`,
      );
    }
    return reference.provenance.sourceId.slice(prefix.length);
  }

  private searchScore(result: SearchResult, terms: readonly string[]): number {
    const text = `${result.title} ${result.subtitle}`
      .toLocaleLowerCase(this.configuration.locale);
    return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
  }

  private extractTableOfContents(content: string): TocEntry[] {
    const entries: TocEntry[] = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (!match) continue;
      const heading = match[2] ?? '';
      const depth = (match[1]?.length ?? 1) - 1;
      const norm = heading.match(/^(§§?\s*\S+|Art\.?\s*\S+)\s*(.*)/);
      entries.push({
        depth,
        num: norm?.[1] || '',
        title: norm?.[2] || heading,
      });
    }
    return entries;
  }
}
