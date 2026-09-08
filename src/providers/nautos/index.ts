import type { ProviderFactory } from '../../shared/types.js';
import { defineProviderComponent } from '../../contracts/provider-component.js';
import { nautosConfig } from './config.js';
import { NautosProvider } from './provider.js';
import { NautosDataClient } from './data-client.js';

export const createProvider: ProviderFactory = () => {
  if (!nautosConfig.enabled) return null;
  return new NautosProvider();
};

export const component = defineProviderComponent({
  metadata: {
    id: 'nautos',
    description: 'Nautos technical standards',
    distribution: 'public',
    access: 'credentialed',
    resourceTypes: ['technical-standard'],
    enablementVariables: [
      'GLMCP_NAUTOS_ENABLED',
      'GLMCP_NAUTOS_TENANT_KEY',
      'GLMCP_NAUTOS_USERNAME',
      'GLMCP_NAUTOS_PASSWORD',
    ],
    runtime: { browser: false, cache: true, daemon: false, search: true, documents: true, tableOfContents: true, authentication: true, status: false, enumeration: false },
  },
  createMcpProvider: createProvider,
  createDataClient: () => new NautosDataClient(),
});

export * from './data-client.js';
export type * from './client.js';
