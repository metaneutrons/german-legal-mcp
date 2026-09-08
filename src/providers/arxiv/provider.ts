import type { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { ArxivClient } from './client.js';
import { ArxivDataClient } from './data-client.js';
import { arxivTools } from './tools/index.js';
import { handleSearch } from './tools/search.js';
import { handleGet } from './tools/get.js';
import { normalizeToolName } from '../../shared/tool-names.js';

export class ArxivProvider implements Provider {
  readonly name = 'arxiv';
  private readonly client: ArxivDataClient;

  constructor(client: ArxivDataClient | ArxivClient = new ArxivDataClient()) {
    this.client = client instanceof ArxivDataClient
      ? client
      : new ArxivDataClient(client);
  }

  getTools(): ToolDefinition[] { return arxivTools; }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (normalizeToolName(name)) {
      case 'arxiv_search': return handleSearch(this.client, args);
      case 'arxiv_get': return handleGet(this.client, args);
      default: return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  }

  async shutdown(): Promise<void> {}
}
