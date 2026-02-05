import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';

/**
 * RIS (Rechtsprechung im Internet) provider placeholder.
 * This provider will eventually integrate with the free public
 * German federal court decisions database.
 */
export class RisProvider implements Provider {
  readonly name = 'ris';

  /**
   * Returns available tools for this provider.
   * Currently returns empty array as RIS is not yet implemented.
   */
  getTools(): ToolDefinition[] {
    return [];
  }

  /**
   * Handles tool calls for this provider.
   * Currently returns an error as RIS is not yet implemented.
   */
  async handleToolCall(toolName: string, _args: Record<string, unknown>): Promise<ToolResult> {
    return {
      content: [{ type: 'text', text: `RIS provider not implemented: ${toolName}` }],
      isError: true,
    };
  }

  /**
   * Cleanup logic called during shutdown.
   * No-op for placeholder implementation.
   */
  async shutdown(): Promise<void> {
    // No-op - nothing to clean up
  }
}

/** Singleton RIS provider instance */
export const risProvider = new RisProvider();
