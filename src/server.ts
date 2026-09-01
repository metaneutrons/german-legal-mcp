import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ConfigurationError } from './config.js';
import type { ProviderComponentReference } from './contracts/provider-component.js';
import { getPackageMetadata } from './package-metadata.js';
import { PROVIDER_MANIFEST } from './provider-manifest.js';
import { ProviderRegistry } from './provider-registry.js';
import { formatToolCallError } from './shared/errors.js';
import { rootLogger } from './shared/logger.js';
import {
  DEFAULT_TOOL_CALL_LIMITS,
  ToolCallCancelledError,
  ToolCallCapacityError,
  ToolCallGate,
  type ToolCallGateLimits,
} from './shared/tool-call-gate.js';
import { withTimeout } from './shared/timeout.js';

const TOOL_CALL_DRAIN_TIMEOUT_MS = 5_000;

export interface ServerRuntime {
  readonly server: Server;
  readonly registry: ProviderRegistry;
  connectStdio(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface CreateServerRuntimeOptions {
  manifest?: readonly ProviderComponentReference[];
  version?: string;
  requestIdFactory?: () => string;
  toolCallLimits?: ToolCallGateLimits;
}

/** Explicit composition boundary; importing the package creates no runtime. */
export async function createServerRuntime(
  options: CreateServerRuntimeOptions = {},
): Promise<ServerRuntime> {
  const registry = new ProviderRegistry(options.manifest ?? PROVIDER_MANIFEST);
  await registry.load(({ provider, error }) => {
    if (error instanceof ConfigurationError) {
      rootLogger.warn(`Provider "${provider}" disabled: invalid configuration`, { issues: error.issues });
    } else {
      rootLogger.warn(`Provider "${provider}" disabled: failed to load`, { error });
    }
  });

  const server = new Server(
    { name: 'german-legal-mcp', version: options.version ?? getPackageMetadata().version },
    { capabilities: { tools: {} } },
  );
  const toolCallGate = new ToolCallGate(
    options.toolCallLimits ?? DEFAULT_TOOL_CALL_LIMITS,
  );
  let shutdownPromise: Promise<void> | undefined;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.getTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema as z.ZodTypeAny).toJSONSchema(),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const requestId = options.requestIdFactory?.() ?? randomUUID();
    const logger = rootLogger.child({ requestId });
    const { name, arguments: rawArguments } = request.params;
    const startedAt = Date.now();
    try {
      const result = await toolCallGate.run(async () => {
        logger.info('Tool call received', { tool: name });
        return registry.handleToolCall(
          name,
          (rawArguments as Record<string, unknown> | undefined) ?? {},
          { signal: extra.signal },
        );
      }, extra.signal);
      logger.info('Tool call completed', {
        tool: name,
        durationMs: Date.now() - startedAt,
        isError: result.isError ?? false,
      });
      return { content: result.content, isError: result.isError };
    } catch (error) {
      if (error instanceof ToolCallCapacityError || error instanceof ToolCallCancelledError) {
        logger.debug('Tool call not admitted', {
          tool: name,
          reason: error.code,
          durationMs: Date.now() - startedAt,
        });
      } else {
        logger.error('Tool call failed', error, {
          tool: name,
          durationMs: Date.now() - startedAt,
        });
      }
      return {
        content: [{ type: 'text' as const, text: formatToolCallError(error) }],
        isError: true,
      };
    }
  });

  return {
    server,
    registry,
    async connectStdio() {
      await server.connect(new StdioServerTransport());
      const active = registry.getProviders();
      rootLogger.info(
        `Active providers (${active.length}): ${active.map((provider) => provider.name).join(', ') || 'none'}`,
      );
      rootLogger.info('MCP server connected and ready');
    },
    async shutdown() {
      shutdownPromise ??= (async () => {
        toolCallGate.close();
        try {
          await withTimeout(
            toolCallGate.whenIdle(),
            TOOL_CALL_DRAIN_TIMEOUT_MS,
            'MCP tool-call drain',
          );
        } catch (error) {
          rootLogger.warn('Active tool calls exceeded the shutdown drain budget', { error });
        }
        await registry.shutdown();
        await server.close();
      })();
      await shutdownPromise;
    },
  };
}
