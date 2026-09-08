import { z } from 'zod';

/**
 * Defines an MCP tool with its name, description, and input schema.
 * Used by providers to declare their available tools.
 */
export interface ToolDefinition {
  /** Unique tool identifier with provider prefix (e.g., 'legis_get') */
  name: string;
  /** Human-readable description for MCP clients */
  description: string;
  /** Zod schema defining input parameters */
  inputSchema: z.ZodTypeAny;
}

/**
 * Result returned from a tool execution.
 * Contains MCP content blocks and optional error flag.
 */
export interface ToolResult {
  /** MCP content blocks */
  content: Array<{ type: string; text: string }>;
  /** True if the result represents an error */
  isError?: boolean;
}

export interface ToolCallContext {
  /** MCP request cancellation, forwarded through the registry boundary. */
  readonly signal?: AbortSignal;
}

/** Standard handler contract shared by providers and provider-local adapters. */
export type ToolHandler = (
  toolName: string,
  args: Record<string, unknown>,
  context?: ToolCallContext,
) => Promise<ToolResult>;

/** Factory contract used by the provider registry and provider entry points. */
export type ProviderFactory = () => Provider | null;

/** Request-local cache lookup result with explicit attribution. */
export interface CacheResult<T, TSource extends string = string> {
  value: T | null;
  source: TSource | null;
}

/** Shared status envelope for operational health snapshots. */
export interface HealthStatus<TStatus extends string = string> {
  status: TStatus;
  message: string;
}

/**
 * Provider interface that all legal data source integrations must implement.
 * Enables clean separation of concerns and easy addition of new providers.
 */
export interface Provider {
  /** Unique provider identifier (e.g., 'ris', 'legis') */
  readonly name: string;

  /** 
   * Returns tool definitions for this provider.
   * Returns empty array if provider is not configured (e.g., missing credentials).
   */
  getTools(): ToolDefinition[];

  /**
   * Handles a tool call. toolName includes the provider prefix.
   * @param toolName - Full tool name including prefix (e.g., 'legis_get')
   * @param args - Tool arguments as key-value pairs
   * @returns Promise resolving to the tool result
   */
  handleToolCall: ToolHandler;

  /**
   * Optional initialization logic called during provider registration.
   */
  initialize?(): Promise<void>;

  /**
   * Cleanup logic called during server shutdown.
   * Must release any resources (browser instances, connections, etc.)
   */
  shutdown(): Promise<void>;
}
