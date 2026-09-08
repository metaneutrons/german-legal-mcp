/**
 * Side-effect-free package API. Process startup lives exclusively in
 * `bin/german-legal-mcp.ts`; importing this module never binds stdio, installs
 * signal handlers or exits the host process.
 */
export {
  createServerRuntime,
  type CreateServerRuntimeOptions,
  type ServerRuntime,
} from './server.js';
export { ProviderRegistry, type ProviderLoadFailure } from './provider-registry.js';
export { getPackageMetadata, type PackageMetadata } from './package-metadata.js';
export type { Provider, ToolDefinition, ToolResult } from './shared/types.js';
