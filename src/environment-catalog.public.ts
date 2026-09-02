import type { EnvironmentVariable } from './config-core.js';

export const PUBLIC_ENVIRONMENT_VARIABLES: readonly EnvironmentVariable[] = [
  { name: 'GLMCP_STATE_DIR', description: 'Application state root directory.' },
  { name: 'GLMCP_EXPORT_DIR', description: 'Exclusive root directory for user-requested document exports.' },
  { name: 'GLMCP_LOG_LEVEL', description: 'Structured log level.', defaultValue: 'info' },
  { name: 'GLMCP_ARXIV_ENABLED', description: 'Enable the arXiv provider.', defaultValue: 'true' },
  { name: 'GLMCP_DIP_API_KEY', description: 'DIP API key.', secret: true },
  { name: 'GLMCP_DIP_ENABLED', description: 'Enable the DIP provider.', defaultValue: 'true' },
  { name: 'GLMCP_EUL_ENABLED', description: 'Enable the EUR-Lex provider.', defaultValue: 'true' },
  { name: 'GLMCP_ICU_ENABLED', description: 'Enable the InfoCuria provider.', defaultValue: 'true' },
  { name: 'GLMCP_LEGIS_ENABLED', description: 'Enable the legislation provider.', defaultValue: 'true' },
  { name: 'GLMCP_RII_ENABLED', description: 'Enable the RII provider.', defaultValue: 'true' },
  { name: 'GLMCP_RIS_ENABLED', description: 'Enable the RIS (Austria) provider.', defaultValue: 'true' },
  { name: 'GLMCP_NAUTOS_ENABLED', description: 'Enable the Nautos provider.' },
  { name: 'GLMCP_NAUTOS_TENANT_KEY', description: 'Nautos tenant key.', secret: true },
  { name: 'GLMCP_NAUTOS_TENANT_ID', description: 'Nautos tenant ID.' },
  { name: 'GLMCP_NAUTOS_ENTITLEMENT_ID', description: 'Stable non-secret Nautos licence identity used for cache partitioning.' },
  { name: 'GLMCP_NAUTOS_USERNAME', description: 'Nautos username.', secret: true },
  { name: 'GLMCP_NAUTOS_PASSWORD', description: 'Nautos password.', secret: true },
] as const;
