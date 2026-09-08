import type {
  ProviderComponentModule,
  ProviderComponentReference,
} from '../../contracts/provider-component.js';

function publicComponent(
  id: string,
  load: () => Promise<ProviderComponentModule>,
): ProviderComponentReference {
  return { id, distribution: 'public', load };
}

export const PUBLIC_PROVIDER_MANIFEST: readonly ProviderComponentReference[] = [
  publicComponent('arxiv', () => import('../../providers/arxiv/index.js')),
  publicComponent('dip', () => import('../../providers/dip/index.js')),
  publicComponent('eul', () => import('../../providers/eul/index.js')),
  publicComponent('icu', () => import('../../providers/icu/index.js')),
  publicComponent('legis', () => import('../../providers/legis/index.js')),
  publicComponent('rii', () => import('../../providers/rii/index.js')),
  publicComponent('ris', () => import('../../providers/ris/index.js')),
  publicComponent('nautos', () => import('../../providers/nautos/index.js')),
] as const;
