import type { PackageMetadata } from '../package-metadata.js';
import { PROVIDER_MANIFEST } from '../provider-manifest.js';
import { ProviderRegistry } from '../provider-registry.js';
import { runCli } from '../cli.js';
import { rootLogger } from '../shared/logger.js';

async function withRegistry<T>(callback: (registry: ProviderRegistry) => Promise<T>): Promise<T> {
  const registry = new ProviderRegistry(PROVIDER_MANIFEST);
  try {
    await registry.load(({ provider, error }) => {
      rootLogger.warn(`Provider "${provider}" disabled: failed to load`, { error });
    });
    return await callback(registry);
  } finally {
    await registry.shutdown();
  }
}

function globalHelp(packageMetadata: PackageMetadata, tools: Array<{ name: string; description: string }>): string {
  const maxName = Math.max(0, ...tools.map((tool) => tool.name.length));
  const toolLines = tools
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tool) => `  ${tool.name.padEnd(maxName + 2)}${tool.description.split('.')[0]}.`)
    .join('\n');
  return `
German Legal MCP Server v${packageMetadata.version}

A Model Context Protocol server for German, Austrian and EU legal research.

USAGE:
  german-legal-mcp [OPTIONS]
  german-legal-mcp <tool> [--flag value ...]

OPTIONS:
  -h, --help       Print this help message
  -v, --version    Print version number

TOOLS (${tools.length}):
${toolLines}

For more information, visit:
  https://github.com/metaneutrons/german-legal-mcp
`;
}

export async function runCommandLine(
  argv: readonly string[],
  packageMetadata: PackageMetadata,
): Promise<number> {
  const command = argv[0];
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${packageMetadata.version}\n`);
    return 0;
  }
  if (command === undefined || command === '--help' || command === '-h') {
    return withRegistry(async (registry) => {
      const tools = registry.getTools().map(({ name, description }) => ({ name, description }));
      process.stdout.write(globalHelp(packageMetadata, tools));
      return 0;
    });
  }
  return withRegistry((registry) => runCli(argv, registry));
}
