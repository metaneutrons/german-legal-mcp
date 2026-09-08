import type { ProviderFactory } from '../../shared/types.js';
import { defineProviderComponent } from '../../contracts/provider-component.js';
import { arxivConfig } from './config.js';
import { ArxivProvider } from './provider.js';
import { ArxivDataClient } from './data-client.js';

export const createProvider: ProviderFactory = () => {
  if (!arxivConfig.enabled) return null;
  return new ArxivProvider();
};

export const component = defineProviderComponent({
  metadata: {
    id: 'arxiv',
    description: 'arXiv legal and interdisciplinary preprints',
    distribution: 'public',
    access: 'public',
    resourceTypes: ['literature'],
    enablementVariables: ['GLMCP_ARXIV_ENABLED'],
    runtime: { browser: false, cache: false, daemon: false, search: true, documents: true, tableOfContents: false, authentication: false, status: false, enumeration: false },
  },
  createMcpProvider: createProvider,
  createDataClient: () => new ArxivDataClient(),
});

export * from './data-client.js';
export type * from './client.js';
