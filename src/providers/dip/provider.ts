import type { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { DipClient } from './client.js';
import { DipDataClient } from './data-client.js';
import { dipTools } from './tools/index.js';
import { handleSearch } from './tools/search.js';
import { handleGet } from './tools/get.js';
import { handleSearchVorgang } from './tools/vorgang.js';
import { handleSearchPlenarprotokoll } from './tools/plenarprotokoll.js';
import { normalizeToolName } from '../../shared/tool-names.js';

export class DipProvider implements Provider {
  readonly name = 'dip';
  private readonly client: DipDataClient;

  constructor(client: DipDataClient | DipClient = new DipDataClient()) {
    this.client = client instanceof DipDataClient
      ? client
      : new DipDataClient(client);
  }

  getTools(): ToolDefinition[] { return dipTools; }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (normalizeToolName(name)) {
      case 'dip_search': return handleSearch(this.client, args);
      case 'dip_get': return handleGet(this.client, args);
      case 'dip_search_vorgang': return handleSearchVorgang(this.client, args);
      case 'dip_search_plenarprotokoll': return handleSearchPlenarprotokoll(this.client, args);
      default: return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  }

  async shutdown(): Promise<void> {}
}
