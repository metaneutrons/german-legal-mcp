#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from 'zod';
import { Provider, ToolResult } from "./shared/types.js";
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { rootLogger } from './shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Handle --version flag
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
  console.log(packageJson.version);
  process.exit(0);
}

// Handle --help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
German Legal MCP Server v${JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')).version}

A Model Context Protocol server for German legal research.

USAGE:
  node dist/index.js [OPTIONS]

OPTIONS:
  -h, --help       Print this help message
  -v, --version    Print version number

For more information, visit:
  https://github.com/metaneutrons/german-legal-mcp
`);
  process.exit(0);
}

// Provider registry
const providers: Map<string, Provider> = new Map();

async function registerProvider(provider: Provider): Promise<void> {
  providers.set(provider.name, provider);
  if (provider.initialize) {
    await provider.initialize();
  }
}

function getAllTools() {
  return Array.from(providers.values()).flatMap((p) => p.getTools());
}

async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const colonIndex = toolName.indexOf(":");
  if (colonIndex === -1) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  const prefix = toolName.substring(0, colonIndex);
  const rest = toolName.substring(colonIndex + 1);
  
  let version = 'v1';
  if (rest.startsWith('v') && rest.includes(':')) {
    const versionEnd = rest.indexOf(':');
    version = rest.substring(0, versionEnd);
  }

  const provider = providers.get(prefix);

  if (!provider) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  if (version !== 'v1') {
    rootLogger.warn('Non-v1 API version used', { toolName, version });
  }

  return provider.handleToolCall(toolName, args);
}

async function shutdownAllProviders(): Promise<void> {
  for (const provider of providers.values()) {
    await provider.shutdown();
  }
}

// Create MCP server
const server = new Server(
  {
    name: "german-legal-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = getAllTools();
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema as z.ZodTypeAny).toJSONSchema(),
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const requestId = uuidv4();
  const logger = rootLogger.child({ requestId });
  const { name, arguments: args } = request.params;
  
  logger.info('Tool call received', { tool: name });
  const startTime = Date.now();
  
  try {
    const result = await handleToolCall(name, (args as Record<string, unknown>) || {});
    const duration = Date.now() - startTime;
    logger.info('Tool call completed', { tool: name, duration });
    
    return {
      content: result.content,
      isError: result.isError,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Tool call failed', error as Error, { tool: name, duration });
    return {
      content: [{ 
        type: 'text', 
        text: `Error: ${error instanceof Error ? error.message : String(error)}\nRequest ID: ${requestId}` 
      }],
      isError: true,
    };
  }
});

// Graceful shutdown
let isShuttingDown = false;

async function cleanup(signal?: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  rootLogger.info('Shutdown initiated', { signal });

  const shutdownPromise = (async () => {
    try {
      await shutdownAllProviders();
      rootLogger.info('Cleanup complete');
    } catch (error) {
      rootLogger.error('Error during cleanup', { error });
    }
  })();

  const timeoutPromise = new Promise<void>((resolve) => {
    // eslint-disable-next-line no-undef
    setTimeout(() => {
      rootLogger.warn('Shutdown timeout reached, forcing exit');
      resolve();
    }, 30000);
  });

  await Promise.race([shutdownPromise, timeoutPromise]);
  process.exit(0);
}

process.on("SIGINT", () => cleanup("SIGINT"));
process.on("SIGTERM", () => cleanup("SIGTERM"));
process.stdin.on("close", () => cleanup("stdin close"));

// Dynamic provider loading
const providersDir = join(__dirname, 'providers');
for (const entry of readdirSync(providersDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  try {
    const mod = await import(`./providers/${entry.name}/index.js`);
    if (typeof mod.createProvider === 'function') {
      const provider = mod.createProvider() as Provider | null;
      if (provider) {
        await registerProvider(provider);
        rootLogger.info(`Provider registered: ${provider.name}`);
      }
    }
  } catch (error) {
    rootLogger.error(`Failed to load provider from ${entry.name}`, { error });
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
rootLogger.info('MCP server connected and ready');
