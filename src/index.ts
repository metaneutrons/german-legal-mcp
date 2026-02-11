#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Provider, ToolResult } from "./shared/types.js";
import { beckProvider } from "./providers/beck/index.js";
import { risProvider } from "./providers/ris/index.js";

/**
 * Thin orchestrator for the German Legal MCP Server.
 * Manages provider lifecycle and routes tool requests.
 */

// Provider registry
const providers: Map<string, Provider> = new Map();

/**
 * Register a provider with the orchestrator.
 * Calls initialize() if defined on the provider.
 */
async function registerProvider(provider: Provider): Promise<void> {
  providers.set(provider.name, provider);
  if (provider.initialize) {
    await provider.initialize();
  }
}

/**
 * Get all tools from all registered providers.
 * Aggregates tool definitions from providers that have tools available.
 */
function getAllTools() {
  return Array.from(providers.values()).flatMap((p) => p.getTools());
}

/**
 * Route a tool call to the appropriate provider based on prefix.
 * Tool names are expected in format: {provider}:{action}
 */
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
  const provider = providers.get(prefix);

  if (!provider) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  return provider.handleToolCall(toolName, args);
}

/**
 * Shutdown all registered providers.
 */
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

// List tools handler - aggregates tools from all providers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = getAllTools();
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// Call tool handler - routes to appropriate provider
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleToolCall(name, (args as Record<string, unknown>) || {});
  return {
    content: result.content,
    isError: result.isError,
  };
});

// Graceful shutdown handler
async function cleanup() {
  console.error("[German-Legal MCP] Shutting down and cleaning up...");
  await shutdownAllProviders();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.stdin.on("close", async () => {
  await cleanup();
});

// Register providers and start server
await registerProvider(beckProvider);
await registerProvider(risProvider);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[German-Legal MCP] Server connected and ready.");
