import type {
  LegalResourceReference,
  LegalResourceType,
  LegalSearchPage,
} from './legal-resource.js';

export interface LegalTableOfContentsEntry {
  readonly id: string;
  readonly title: string;
  readonly label?: string;
  readonly level: number;
  readonly children?: readonly LegalTableOfContentsEntry[];
}

export interface LegalTableOfContents<
  TReference extends LegalResourceReference = LegalResourceReference,
> {
  readonly reference: TReference;
  /** Native means supplied by the source; derived means parsed from content. */
  readonly origin: 'native' | 'derived';
  readonly entries: readonly LegalTableOfContentsEntry[];
}

export interface TableOfContentsCapability<
  TReference extends LegalResourceReference = LegalResourceReference,
> {
  getTableOfContents(
    reference: TReference,
  ): Promise<LegalTableOfContents<TReference>>;
}

export type AuthenticationState =
  | 'authenticated'
  | 'unauthenticated'
  | 'expired'
  | 'unavailable'
  | 'unknown';

export type AuthenticationMethod =
  | 'credentials'
  | 'institutional'
  | 'network'
  | 'persisted-session'
  | 'none'
  | 'other';

export interface ProviderAuthenticationStatus {
  readonly state: AuthenticationState;
  readonly method: AuthenticationMethod;
  readonly expiresAt?: string;
  readonly message?: string;
}

/**
 * Generic session lifecycle. Credentials and browser details remain provider
 * configuration; consumers only request a fresh session or log it out.
 */
export interface AuthenticationCapability {
  getAuthenticationStatus(): Promise<ProviderAuthenticationStatus>;
  refreshAuthentication(): Promise<ProviderAuthenticationStatus>;
  logout(): Promise<void>;
}

export type ProviderOperationalState =
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'unknown';

export interface ProviderOperationalStatus {
  readonly state: ProviderOperationalState;
  readonly checkedAt: string;
  readonly message?: string;
  readonly queueDepth?: number;
  readonly activeRequests?: number;
  readonly circuit?: 'closed' | 'open' | 'half-open' | 'unknown';
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface StatusCapability {
  getOperationalStatus(): Promise<ProviderOperationalStatus>;
}

/**
 * How far back an enumeration reaches, and from where it resumes.
 *
 * `since` is a lower bound in ISO 8601. Which date it actually filters on is
 * the provider's to document: portals expose publication, decision and
 * modification dates inconsistently, and several expose more than one without
 * saying which their listing is ordered by. Omit it for a full walk.
 */
export interface CorpusEnumerationRequest {
  readonly since?: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly resourceTypes?: readonly LegalResourceType[];
  readonly jurisdictions?: readonly string[];
  readonly sourceIds?: readonly string[];
}

export interface CorpusEnumerationPage<
  TReference extends LegalResourceReference = LegalResourceReference,
> extends LegalSearchPage<TReference> {
  /**
   * How `since` was honoured, which decides what a delta run actually costs.
   *
   * - `native` — the source applied the bound itself. The response is the
   *   delta, and cost scales with it.
   * - `derived` — the provider pulled a full listing and filtered locally. The
   *   result is a correct delta, but every run pays for the whole listing.
   *   RII is this case: one 23 MB `rii-toc.xml` carries a `<modified>` stamp
   *   per item, so filtering is exact and the fixed cost is a single request.
   * - `unfiltered` — the bound could not be applied at all, because the
   *   listing exposes no date, and every known item is returned. GII is this
   *   case: `gii-toc.xml` carries only title and link, so the only way to find
   *   what changed is to fetch all 6,127 archives and compare hashes.
   *
   * The distance between `derived` and `unfiltered` is orders of magnitude —
   * one extra request against a listing, versus refetching the corpus — which
   * is why they are not the same value. A caller can schedule a `derived`
   * source nightly and should schedule an `unfiltered` one far less often.
   */
  readonly origin: 'native' | 'derived' | 'unfiltered';
}

/**
 * Walking a source, rather than asking it a question.
 *
 * `LegalDataProvider.search` is question-shaped: it requires a query and
 * returns what matches. That is the right shape for research and the wrong one
 * for building an index, where the caller wants everything a source holds and
 * afterwards only what it gained. Approximating enumeration by iterating a
 * query space fails quietly — per-query hit caps truncate, relevance ordering
 * is unstable between runs, and total coverage is unknowable.
 *
 * Implement this only where the portal offers a listing that can actually be
 * walked. A provider that accepted `since` and ignored it would turn every
 * incremental run into a silent full re-crawl, which is precisely the failure
 * this interface exists to make visible.
 */
export interface CorpusEnumerationCapability<
  TReference extends LegalResourceReference = LegalResourceReference,
> {
  enumerate(
    request?: CorpusEnumerationRequest,
  ): Promise<CorpusEnumerationPage<TReference>>;
}
