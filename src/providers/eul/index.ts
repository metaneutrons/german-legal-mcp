import type { ProviderFactory } from '../../shared/types.js';
import { defineProviderComponent } from '../../contracts/provider-component.js';
import { readBooleanEnv } from '../../config.js';
import { EulProvider } from './provider.js';
import { EulDataClient } from './data-client.js';

export const createProvider: ProviderFactory = () => {
  if (!readBooleanEnv('GLMCP_EUL_ENABLED', true)) return null;
  return new EulProvider();
};

export const component = defineProviderComponent({
  metadata: {
    id: 'eul',
    description: 'EUR-Lex European Union law',
    distribution: 'public',
    access: 'public',
    resourceTypes: ['legislation'],
    enablementVariables: ['GLMCP_EUL_ENABLED'],
    runtime: { browser: false, cache: false, daemon: false, search: true, documents: true, tableOfContents: false, authentication: false, status: false, enumeration: true },
  },
  createMcpProvider: createProvider,
  createDataClient: () => new EulDataClient(),
});

export * from './data-client.js';
