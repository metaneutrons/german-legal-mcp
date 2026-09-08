export {
  CaseLawClient,
  GERMAN_CASE_LAW_CONFIGURATION,
  GERMAN_CASE_LAW_PROVIDER_ID,
  PUBLIC_CASE_LAW_RIGHTS,
  createGermanDecisionAdapters,
} from '../../providers/rii/client.js';
export type {
  CaseLawClientConfiguration,
  CaseLawSearchOptions,
} from '../../providers/rii/client.js';
export type {
  DecisionAdapter,
  DecisionEntry,
  DecisionGetOptions,
  DecisionSearchBatch,
  DecisionSearchResult,
  DecisionSourceFailure,
  SourcedDecisionSearchResult,
} from '../../providers/rii/types.js';
