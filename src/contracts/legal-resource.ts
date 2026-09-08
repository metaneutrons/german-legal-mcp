export const LEGAL_RESOURCE_TYPES = [
  'case-law',
  'legislation',
  'literature',
  'parliamentary-material',
  'technical-standard',
] as const;

export type LegalResourceType = (typeof LEGAL_RESOURCE_TYPES)[number];

export type ProviderAccess = 'public' | 'credentialed' | 'subscription';

export type FullTextStoragePolicy =
  | 'allowed'
  | 'cache-only'
  | 'prohibited'
  | 'unknown';

export type RedistributionPolicy =
  | 'allowed'
  | 'share-alike'
  | 'metadata-only'
  | 'prohibited'
  | 'unknown';

export interface LegalResourceRights {
  readonly access: ProviderAccess;
  readonly fullTextStorage: FullTextStoragePolicy;
  /**
   * What a consumer may do — the policy a serving gate enforces.
   *
   * `share-alike` is not a softer `allowed`: the text may be served, but
   * attribution is mandatory and the obligation propagates to derived
   * databases. Collapsing it into `allowed` would make a licence's conditions
   * invisible to the code meant to honour them.
   */
  readonly redistribution: RedistributionPolicy;
  /**
   * What the source actually says, as an SPDX identifier or expression —
   * `ODbL-1.0`, `CC-BY-4.0`, `CC-BY-NC-4.0`, `DL-DE-BY-2.0`, or a
   * `LicenseRef-…` for terms with no SPDX entry.
   *
   * Deliberately separate from `redistribution`: this is the *fact*, that is
   * the *assessment*. Keeping them apart is what makes the assessment
   * auditable — and lets a consumer render the right attribution and reason
   * about compatibility between two share-alike sources, which a policy enum
   * alone cannot express.
   *
   * `NOASSERTION` means nobody has determined it yet. It is SPDX's own term
   * for exactly that, and it pairs with `redistribution: 'unknown'`.
   */
  readonly licence: string;
}

export interface LegalResourceProvenance {
  readonly providerId: string;
  readonly sourceId: string;
  readonly providerDocumentId: string;
  readonly canonicalUrl?: string;
  readonly retrievedAt?: string;
}

export interface LegalResourceReference {
  readonly resourceType: LegalResourceType;
  readonly title: string;
  readonly jurisdiction?: string;
  readonly language?: string;
  readonly decisionDate?: string;
  readonly publicationDate?: string;
  readonly provenance: LegalResourceProvenance;
  readonly rights: LegalResourceRights;
}

export interface CaseLawReference extends LegalResourceReference {
  readonly resourceType: 'case-law';
  readonly court?: string;
  readonly fileNumber?: string;
  readonly ecli?: string;
  /** Deciding body within the court — "1. Zivilsenat", "Großer Senat". */
  readonly chamber?: string;
  /** "Urteil", "Beschluss", "Versäumnisurteil" — as the source names it. */
  readonly documentType?: string;
  /**
   * Norms the court applied, as published: `§ 8 Abs 2 Nr 1 MarkenG`.
   *
   * Optional because most sources make a consumer find these in the prose.
   * Where a source states them — RII does, in its XML distribution — carrying
   * them through is the difference between reading a citation graph off the
   * document and inferring one from running text.
   */
  readonly citedNorms?: readonly string[];
  /** Prior instances, as the source states them. */
  readonly priorInstances?: readonly string[];
}

export interface LegislationReference extends LegalResourceReference {
  readonly resourceType: 'legislation';
  readonly eli?: string;
  readonly celex?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
}

export interface LiteratureReference extends LegalResourceReference {
  readonly resourceType: 'literature';
  readonly authors?: readonly string[];
  readonly journal?: string;
  readonly doi?: string;
}

export interface ParliamentaryMaterialReference extends LegalResourceReference {
  readonly resourceType: 'parliamentary-material';
  readonly documentNumber?: string;
  readonly legislativePeriod?: number;
  readonly issuer?: string;
}

export interface TechnicalStandardReference extends LegalResourceReference {
  readonly resourceType: 'technical-standard';
  readonly documentNumber?: string;
  readonly standardBodies?: readonly string[];
  readonly valid?: boolean;
}

/**
 * Closed union of the normalized reference shapes currently supported by the
 * package. Multi-domain providers use this (or a narrower union) as their
 * discriminated result type; consumers narrow on `resourceType`.
 */
export type KnownLegalResourceReference =
  | CaseLawReference
  | LegislationReference
  | LiteratureReference
  | ParliamentaryMaterialReference
  | TechnicalStandardReference;

export interface LegalResourceContent {
  readonly format: 'markdown' | 'html' | 'text' | 'xml';
  readonly value: string;
}

export interface LegalResourceDocument<TReference extends LegalResourceReference = LegalResourceReference> {
  readonly reference: TReference;
  readonly content: LegalResourceContent;
}

export interface LegalSearchRequest {
  readonly query: string;
  readonly resourceTypes?: readonly LegalResourceType[];
  readonly jurisdictions?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ProviderFailure {
  readonly sourceId: string;
  readonly message: string;
  readonly cause?: unknown;
}

export interface LegalSearchPage<TReference extends LegalResourceReference = LegalResourceReference> {
  readonly results: readonly TReference[];
  readonly failures: readonly ProviderFailure[];
  readonly nextCursor?: string;
}

export interface LegalDataProvider<
  TReference extends LegalResourceReference = LegalResourceReference,
  TDocument extends LegalResourceDocument<TReference> = LegalResourceDocument<TReference>,
> {
  search(request: LegalSearchRequest): Promise<LegalSearchPage<TReference>>;
  get(reference: TReference): Promise<TDocument>;
}
