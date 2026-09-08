import type {
  ProviderComponentReference,
  ProviderDistribution,
} from '../../contracts/provider-component.js';

export function filterProviderManifest(
  manifest: readonly ProviderComponentReference[],
  distribution?: ProviderDistribution,
): readonly ProviderComponentReference[] {
  return distribution === undefined
    ? manifest
    : manifest.filter((entry) => entry.distribution === distribution);
}
