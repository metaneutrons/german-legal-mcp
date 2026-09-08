export {
  GERMAN_LEGISLATION_CONFIGURATION,
  GERMAN_LEGISLATION_PROVIDER_ID,
  LegislationClient,
  PUBLIC_LEGISLATION_RIGHTS,
  createGermanLegislationAdapters,
} from '../../providers/legis/client.js';
export type {
  LegislationClientConfiguration,
  LegislationSearchBatch,
  LegislationSearchOptions,
  LegislationSourceFailure,
  SourcedLegislationSearchResult,
} from '../../providers/legis/client.js';
export type {
  LegisAdapter,
  LegisEntry,
  SearchResult,
  TocEntry,
} from '../../providers/legis/types.js';
