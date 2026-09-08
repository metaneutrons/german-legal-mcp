import type { ProviderFactory } from '../../shared/types.js';
import { defineProviderComponent } from '../../contracts/provider-component.js';
import { readBooleanEnv } from '../../config.js';
import { RiiProvider } from './provider.js';
import { CaseLawClient } from './client.js';

export const createProvider: ProviderFactory = () => {
  if (!readBooleanEnv('GLMCP_RII_ENABLED', true)) return null;
  return new RiiProvider();
};

export const component = defineProviderComponent({
  metadata: {
    id: 'rii',
    description: 'German federal and state case law',
    distribution: 'public',
    access: 'public',
    resourceTypes: ['case-law'],
    enablementVariables: ['GLMCP_RII_ENABLED'],
    runtime: { browser: false, cache: false, daemon: false, search: true, documents: true, tableOfContents: false, authentication: false, status: false, enumeration: true },
  },
  createMcpProvider: createProvider,
  createDataClient: () => new CaseLawClient(),
});

export * from './client.js';
export type * from './types.js';
