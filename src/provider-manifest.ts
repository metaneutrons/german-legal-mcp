import type { ProviderDistribution } from './contracts/provider-component.js';
import { filterProviderManifest } from './components/manifests/filter.js';
import { PUBLIC_PROVIDER_MANIFEST } from './components/manifests/public.js';

export const PROVIDER_MANIFEST = PUBLIC_PROVIDER_MANIFEST;

export function getProviderManifest(
  distribution?: ProviderDistribution,
) {
  return filterProviderManifest(PROVIDER_MANIFEST, distribution);
}
