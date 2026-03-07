import axios from 'axios';
import * as cheerio from 'cheerio';
import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { rootLogger } from '../../shared/logger.js';
import { RiiConverter } from './converter.js';
import { riiTools } from './tools/index.js';

const logger = rootLogger.child({ module: 'rii-provider' });

const BASE_URL = 'https://www.rechtsprechung-im-internet.de/jportal/portal/page/bsjrsprod.psml';

export class RiiProvider implements Provider {
  readonly name = 'rii';
  private converter: RiiConverter;

  constructor() {
    this.converter = new RiiConverter();
  }

  getTools(): ToolDefinition[] {
    return riiTools;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName === 'rii:search') return this.handleSearch(args);
    if (toolName === 'rii:get_decision') return this.handleGetDecision(args);

    return {
      content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  async shutdown(): Promise<void> {
    logger.info('RII provider shutdown');
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const { query, limit = 10 } = args as { query: string; limit?: number };

    try {
      const url = `${BASE_URL}/js_peid/Suchportlet2/media-type/html`;
      logger.info('Searching', { query });

      const response = await axios.get(url, {
        params: {
          formhaschangedvalue: 'yes',
          eventSubmit_doSearch: 'suchen',
          action: 'portlets.jw.MainAction',
          form: 'jurisExpertSearch',
          desc: 'text',
          query,
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; German-Legal-MCP/1.0)',
        },
      });

      const $ = cheerio.load(response.data);
      const results: Array<{ title: string; docId: string; snippet: string }> = [];

      $('a.TrefferlisteHervorheben[id^="tlid"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const docIdMatch = href.match(/doc\.id=([^&]+)/);
        const title = $(el).attr('title') || $(el).text().trim();
        
        // Only take main links (not Kurztext/Langtext sub-links)
        if (docIdMatch && !$(el).attr('id')?.includes('.')) {
          const snippet = $(el).closest('tr').find('.docPreview').text().trim();
          results.push({
            title,
            docId: docIdMatch[1],
            snippet,
          });
        }
      });

      const limitedResults = results.slice(0, limit);

      const markdown = limitedResults
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}**\n   - Doc ID: \`${r.docId}\`${r.snippet ? `\n   - ${r.snippet}` : ''}`
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${results.length} results (showing ${limitedResults.length}):\n\n${markdown}`,
          },
        ],
      };
    } catch (error) {
      logger.error('Search failed', error as Error, { query });
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleGetDecision(args: Record<string, unknown>): Promise<ToolResult> {
    const { doc_id, part = 'L', save_path } = args as { doc_id: string; part?: string; save_path?: string };

    try {
      logger.info('Fetching decision', { doc_id, part });

      const response = await axios.get(BASE_URL, {
        params: {
          'doc.id': doc_id,
          'doc.part': part,
          showdoccase: '1',
          paramfromHL: 'true',
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; German-Legal-MCP/1.0)',
        },
      });

      const decision = this.converter.extractDecision(response.data);

      const markdown = `# ${decision.title}

**Court:** ${decision.court}  
**Date:** ${decision.date}  
**File Number:** ${decision.fileNumber}  
**ECLI:** ${decision.ecli}

---

${decision.content}`;

      if (save_path) {
        const { writeFile } = await import('fs/promises');
        await writeFile(save_path, markdown, 'utf-8');
        return {
          content: [{ type: 'text', text: `Saved to ${save_path}\n\nCourt: ${decision.court}\nDate: ${decision.date}\nFile Number: ${decision.fileNumber}\nECLI: ${decision.ecli}` }],
        };
      }

      return {
        content: [{ type: 'text', text: markdown }],
      };
    } catch (error) {
      logger.error('Failed to get decision', error as Error, { doc_id });
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
}

