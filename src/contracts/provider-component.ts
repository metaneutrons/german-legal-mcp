import type { Provider } from '../shared/types.js';
import type {
  LegalDataProvider,
  LegalResourceType,
  ProviderAccess,
} from './legal-resource.js';

export type ProviderDistribution = 'public' | 'private';

export interface ProviderRuntimeCapabilities {
  readonly browser: boolean;
  readonly cache: boolean;
  readonly daemon: boolean;
  readonly search: boolean;
  readonly documents: boolean;
  readonly tableOfContents: boolean;
  readonly authentication: boolean;
  readonly status: boolean;
  readonly enumeration: boolean;
}

export interface ProviderComponentMetadata {
  readonly id: string;
  readonly description: string;
  readonly distribution: ProviderDistribution;
  readonly access: ProviderAccess;
  readonly resourceTypes: readonly LegalResourceType[];
  readonly enablementVariables: readonly string[];
  readonly runtime: ProviderRuntimeCapabilities;
}

export interface ProviderComponent<
  TDataClient extends LegalDataProvider = LegalDataProvider,
> {
  readonly metadata: ProviderComponentMetadata;
  readonly createMcpProvider: () => Provider | null;
  readonly createDataClient: () => TDataClient;
}

export interface ProviderComponentModule {
  readonly component: ProviderComponent;
}

export interface ProviderComponentReference {
  readonly id: string;
  readonly distribution: ProviderDistribution;
  readonly load: () => Promise<ProviderComponentModule>;
}

export function defineProviderComponent<
  TDataClient extends LegalDataProvider = LegalDataProvider,
>(component: ProviderComponent<TDataClient>): ProviderComponent<TDataClient> {
  return component;
}
