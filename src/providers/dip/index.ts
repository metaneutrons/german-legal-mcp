import type { ProviderFactory } from '../../shared/types.js';
import { defineProviderComponent } from '../../contracts/provider-component.js';
import { dipConfig } from './config.js';
import { DipProvider } from './provider.js';
import { DipDataClient } from './data-client.js';

export const createProvider: ProviderFactory = () => {
  if (!dipConfig.enabled) return null;
  return new DipProvider();
};

export const component = defineProviderComponent({
  metadata: {
    id: 'dip',
    description: 'German Bundestag parliamentary information',
    distribution: 'public',
    access: 'public',
    resourceTypes: ['parliamentary-material'],
    enablementVariables: ['GLMCP_DIP_ENABLED', 'GLMCP_DIP_API_KEY'],
    runtime: { browser: false, cache: false, daemon: false, search: true, documents: true, tableOfContents: false, authentication: false, status: false, enumeration: true },
  },
  createMcpProvider: createProvider,
  createDataClient: () => new DipDataClient(),
});

export * from './data-client.js';
export type * from './client.js';
