import axios from 'axios';
import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { rootLogger } from '../../shared/logger.js';
import { GiiConverter } from './converter.js';
import { giiTools } from './tools/index.js';

const logger = rootLogger.child({ module: 'gii' });

class GiiProvider implements Provider {
  readonly name = 'gii';
  private converter: GiiConverter;
  private baseUrl = 'https://www.gesetze-im-internet.de';

  constructor() {
    this.converter = new GiiConverter();
  }

  getTools(): ToolDefinition[] {
    return giiTools;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName === 'gii:get_legislation') {
      return this.handleGetLegislation(args);
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  async shutdown(): Promise<void> {
    logger.info('GII provider shutdown');
  }

  private async handleGetLegislation(args: Record<string, unknown>): Promise<ToolResult> {
    const { law, section, save_path } = args as { law: string; section: string; save_path?: string };

    try {
      const result = await this.getLegislation(law, section);
      
      const markdown = `# ${result.title}\n\n${result.content}\n\n---\n**Source:** ${result.url}`;

      if (save_path) {
        const { writeFile } = await import('fs/promises');
        await writeFile(save_path, markdown, 'utf-8');
        return {
          content: [{ type: 'text', text: `Saved to ${save_path}\n\nTitle: ${result.title}\nURL: ${result.url}` }],
        };
      }

      return {
        content: [{ type: 'text', text: markdown }],
      };
    } catch (error) {
      logger.error('Failed to get legislation', error as Error, { law, section });
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async getLegislation(law: string, section: string): Promise<{
    title: string;
    section: string;
    content: string;
    url: string;
    prev: string | null;
    next: string | null;
  }> {
    const lawNorm = law.toLowerCase();
    
    let sectionNorm = section.trim();
    sectionNorm = sectionNorm.replace(/^(§|Paragraph|Para\.?|Art\.?)\s*/i, '');
    if (!sectionNorm.startsWith('__')) {
      sectionNorm = '__' + sectionNorm;
    }
    
    const url = `${this.baseUrl}/${lawNorm}/${sectionNorm}.html`;
    logger.info('Fetching legislation', { law, section, url });

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; German-Legal-MCP/1.0)',
        },
        responseType: 'arraybuffer',
      });

      const html = Buffer.from(response.data).toString('latin1');
      const result = this.converter.extractLegislation(html);
      return {
        ...result,
        url,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(`Legislation not found: ${law} ${section}`);
      }
      throw error;
    }
  }
}

export function createProvider(): Provider | null {
  if (process.env.GLMCP_GII_ENABLED === 'false') return null;
  return new GiiProvider();
}
