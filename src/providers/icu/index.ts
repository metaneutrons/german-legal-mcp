import type { ProviderFactory } from '../../shared/types.js';
import { defineProviderComponent } from '../../contracts/provider-component.js';
import { readBooleanEnv } from '../../config.js';
import { IcuProvider } from './provider.js';
import { IcuDataClient } from './data-client.js';

export const createProvider: ProviderFactory = () => {
  if (!readBooleanEnv('GLMCP_ICU_ENABLED', true)) return null;
  return new IcuProvider();
};

export const component = defineProviderComponent({
  metadata: {
    id: 'icu',
    description: 'InfoCuria Court of Justice case law',
    distribution: 'public',
    access: 'public',
    resourceTypes: ['case-law'],
    enablementVariables: ['GLMCP_ICU_ENABLED'],
    runtime: { browser: false, cache: false, daemon: false, search: true, documents: true, tableOfContents: false, authentication: false, status: false, enumeration: true },
  },
  createMcpProvider: createProvider,
  createDataClient: () => new IcuDataClient(),
});

export * from './data-client.js';
