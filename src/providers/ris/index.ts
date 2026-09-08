import type { ProviderFactory } from '../../shared/types.js';
import { defineProviderComponent } from '../../contracts/provider-component.js';
import { readBooleanEnv } from '../../config.js';
import { RisProvider } from './provider.js';
import { RisDataClient } from './data-client.js';

export const createProvider: ProviderFactory = () => {
  if (!readBooleanEnv('GLMCP_RIS_ENABLED', true)) return null;
  return new RisProvider();
};

export const component = defineProviderComponent({
  metadata: {
    id: 'ris',
    description: 'Austrian federal and state law and case law',
    distribution: 'public',
    access: 'public',
    resourceTypes: ['legislation', 'case-law'],
    enablementVariables: ['GLMCP_RIS_ENABLED'],
    runtime: { browser: false, cache: false, daemon: false, search: true, documents: true, tableOfContents: true, authentication: false, status: false, enumeration: false },
  },
  createMcpProvider: createProvider,
  createDataClient: () => new RisDataClient(),
});

export * from './data-client.js';
export type * from './client.js';
export type * from './types.js';
