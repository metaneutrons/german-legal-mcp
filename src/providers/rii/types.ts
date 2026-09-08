/** Normalized case-law contract shared by all RII sources. */
export interface DecisionSearchResult {
  id: string;
  title: string;
  subtitle: string;
  date: string;
  court?: string;
  fileNumber?: string;
  ecli?: string;
  snippet?: string;
  url?: string;
}

export interface SourcedDecisionSearchResult extends DecisionSearchResult {
  source: string;
}

export interface DecisionEntry {
  title: string;
  content: string;
  url: string;
  court: string;
  date: string;
  fileNumber: string;
  ecli?: string;
  /**
   * The fields below are published as tagged data in RII's XML distribution and
   * are absent from the rendered page, so only the archive route fills them.
   * `headnotes` and `norms` were declared here long before anything populated
   * them; the HTML scrape could not.
   */
  headnotes?: string[];
  norms?: string[];
  chamber?: string;
  documentType?: string;
  priorInstances?: string[];
}

export interface DecisionGetOptions {
  part?: string;
}

/** A page of results plus the upstream total, where the source publishes one. */
export interface DecisionPage {
  results: DecisionSearchResult[];
  totalHits?: number;
  /**
   * Set when the source cannot reach the requested page. Callers surface this
   * rather than silently returning page one again, which would duplicate rows
   * already shown.
   */
  pagingUnsupported?: boolean;
}

export interface DecisionEnumerationRequest {
  /**
   * ISO 8601 lower bound, compared against the source's own modification
   * stamp. Date-only values work: `2026-08-01` sorts below
   * `2026-08-06T21:08:06.267Z`.
   */
  since?: string;
  cursor?: string;
  limit?: number;
}

/**
 * A page of a corpus walk. `origin` carries the same meaning as on the
 * contract's `CorpusEnumerationPage` and decides what a delta run costs.
 */
export interface DecisionEnumerationPage {
  results: DecisionSearchResult[];
  nextCursor?: string;
  origin: 'native' | 'derived' | 'unfiltered';
}

export interface DecisionAdapter {
  readonly sources: readonly string[];
  search(source: string, query: string, limit: number): Promise<DecisionSearchResult[]>;
  /**
   * The same search, additionally reporting the source's own hit total.
   *
   * Optional by design: an adapter whose upstream never states a total just
   * doesn't implement it and the client falls back to `search`. That keeps
   * "how many are there really?" from becoming a field every adapter has to
   * fake.
   */
  searchPage?(source: string, query: string, limit: number, page?: number): Promise<DecisionPage>;
  /**
   * Walk the source's whole corpus, rather than answering a query.
   *
   * Optional for the same reason `searchPage` is: most RII portals expose only
   * a stateful search mask, and an adapter that faked enumeration by iterating
   * queries would report coverage it cannot deliver. Adapters implement this
   * only where the portal publishes a listing that can actually be walked.
   */
  enumerate?(source: string, request?: DecisionEnumerationRequest): Promise<DecisionEnumerationPage>;
  get(source: string, id: string, options?: DecisionGetOptions): Promise<DecisionEntry>;
}

export interface DecisionSourceFailure {
  source: string;
  error: unknown;
}

export interface DecisionSearchBatch {
  results: SourcedDecisionSearchResult[];
  failures: DecisionSourceFailure[];
  /** Upstream totals by source, for those that report one. */
  totals?: Record<string, number>;
  /** Sources that could not reach the requested page. */
  unpaged?: string[];
}
