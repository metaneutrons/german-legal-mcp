import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { BeckBrowser } from './browser.js';
import { BeckConverter } from './converter.js';
import { beckToolDefinitions, handleBeckToolCall } from './tools.js';

/**
 * Beck Online provider implementation.
 * Provides access to German legal documents from Beck Online database.
 * 
 * Requires BECK_USERNAME and BECK_PASSWORD environment variables to be set.
 * When credentials are not configured, getTools() returns an empty array.
 */
export class BeckProvider implements Provider {
  readonly name = 'beck';
  private browser: BeckBrowser;
  private converter: BeckConverter;

  constructor() {
    this.browser = BeckBrowser.getInstance();
    this.converter = new BeckConverter();
  }

  /**
   * Check if Beck Online credentials are configured.
   * @returns true if both BECK_USERNAME and BECK_PASSWORD are set
   */
  private isConfigured(): boolean {
    return !!(process.env.BECK_USERNAME && process.env.BECK_PASSWORD);
  }

  /**
   * Returns tool definitions for Beck Online.
   * Returns empty array if credentials are not configured.
   */
  getTools(): ToolDefinition[] {
    return this.isConfigured() ? beckToolDefinitions : [];
  }

  /**
   * Handles a Beck tool call.
   * Returns error if credentials are not configured.
   */
  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.isConfigured()) {
      return {
        content: [{ type: 'text', text: 'Beck Online tools are disabled. Set BECK_USERNAME and BECK_PASSWORD environment variables.' }],
        isError: true,
      };
    }
    return handleBeckToolCall(toolName, args, this.browser, this.converter);
  }

  /**
   * Cleanup: close the browser instance.
   */
  async shutdown(): Promise<void> {
    await this.browser.close();
  }
}

/** Singleton Beck provider instance */
export const beckProvider = new BeckProvider();
