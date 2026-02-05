import { z } from 'zod';

/**
 * Defines an MCP tool with its name, description, and input schema.
 * Used by providers to declare their available tools.
 */
export interface ToolDefinition {
  /** Unique tool identifier with provider prefix (e.g., 'beck:search') */
  name: string;
  /** Human-readable description for MCP clients */
  description: string;
  /** Zod schema defining input parameters */
  inputSchema: z.ZodType<any>;
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

/**
 * Provider interface that all legal data source integrations must implement.
 * Enables clean separation of concerns and easy addition of new providers.
 */
export interface Provider {
  /** Unique provider identifier (e.g., 'beck', 'ris') */
  readonly name: string;

  /** 
   * Returns tool definitions for this provider.
   * Returns empty array if provider is not configured (e.g., missing credentials).
   */
  getTools(): ToolDefinition[];

  /**
   * Handles a tool call. toolName includes the provider prefix.
   * @param toolName - Full tool name including prefix (e.g., 'beck:search')
   * @param args - Tool arguments as key-value pairs
   * @returns Promise resolving to the tool result
   */
  handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;

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
