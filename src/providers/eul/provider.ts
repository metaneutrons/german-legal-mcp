import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { rootLogger } from '../../shared/logger.js';
import { EulConverter } from './converter.js';
import { validateConversion } from '../../shared/converter.js';
import { saveToFile } from '../../shared/save-to-file.js';
import { eulTools } from './tools/index.js';
import { EulDataClient } from './data-client.js';
import { normalizeToolName } from '../../shared/tool-names.js';

const logger = rootLogger.child({ module: 'eul-provider' });

export class EulProvider implements Provider {
  readonly name = 'eul';
  private readonly client: EulDataClient;

  constructor(
    clientOrHttp: EulDataClient | Pick<AxiosInstance, 'get'> = axios,
    converter: EulConverter = new EulConverter(),
  ) {
    this.client = clientOrHttp instanceof EulDataClient
      ? clientOrHttp
      : new EulDataClient(clientOrHttp, converter);
  }

  getTools(): ToolDefinition[] {
    return eulTools;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const canonicalName = normalizeToolName(toolName);
    if (canonicalName === 'eul_search') return this.handleSearch(args);
    if (canonicalName === 'eul_get_document') return this.handleGetDocument(args);
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }

  async shutdown(): Promise<void> {
    logger.info('EUL provider shutdown');
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const { query, resource_type = 'any', language = 'DE', limit = 10 } = args as {
      query: string; resource_type?: string; language?: string; limit?: number;
    };

    logger.info('Searching EUR-Lex', { queryLength: query.length, resource_type });
    const bindings = await this.client.searchLegislation(query, {
      resourceType: resource_type,
      language,
      limit,
    });
    const markdown = bindings.map((b, i) => {
      const celex = b.celex;
      const title = b.title;
      return `${i + 1}. **${celex}**\n   ${title.slice(0, 200)}${title.length > 200 ? '…' : ''}`;
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Found ${bindings.length} results:\n\n${markdown}` }],
    };
  }

  private async handleGetDocument(args: Record<string, unknown>): Promise<ToolResult> {
    const { celex, language = 'DE', section, save_path } = args as {
      celex: string; language?: string; section?: string; save_path?: string;
    };

    logger.info('Fetching EUR-Lex document', { celex, language });

    const markdown = await this.client.getLegislation(celex, language);
    validateConversion(markdown, 'EUR-Lex');

    if (section) {
      const extracted = this.extractSection(markdown, section);
      if (!extracted) {
        return { content: [{ type: 'text', text: `Section "${section}" not found.` }], isError: true };
      }
      return { content: [{ type: 'text', text: extracted }] };
    }

    const fullDoc = `# ${celex}\n\n---\n\n${markdown}`;

    if (save_path) {
      return saveToFile(save_path, fullDoc, `CELEX: ${celex}\nLanguage: ${language}`);
    }

    return { content: [{ type: 'text', text: fullDoc }] };
  }

  private extractSection(markdown: string, section: string): string | null {
    const lines = markdown.split('\n');

    // lines:100-200
    const lineMatch = section.match(/^lines?:(\d+)-(\d+)$/i);
    if (lineMatch) {
      const start = Math.max(1, Number.parseInt(lineMatch[1] ?? '1')) - 1;
      const end = Math.min(lines.length, Number.parseInt(lineMatch[2] ?? '1'));
      return lines.slice(start, end).join('\n');
    }

    // Art. 5 or Artikel 5 or Artikel 5-10
    const artMatch = section.match(/^Art(?:ikel)?\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?$/i);
    if (artMatch) {
      const artStart = Number.parseInt(artMatch[1] ?? '0');
      const artEnd = artMatch[2] ? Number.parseInt(artMatch[2]) : artStart;
      return this.extractArticleRange(lines, artStart, artEnd);
    }

    // Heading match (Kapitel, Abschnitt, etc.)
    const q = section.toLowerCase();
    let startIdx = -1;
    let startLevel = 0;
    for (let i = 0; i < lines.length; i++) {
      const hm = lines[i]?.match(/^(#{1,6})\s+(.+)/);
      if (!hm) continue;
      const level = hm[1]?.length ?? 0;
      const text = hm[2]?.toLowerCase() ?? '';
      if (startIdx === -1) {
        if (text.includes(q)) { startIdx = i; startLevel = level; }
      } else if (level <= startLevel) {
        return lines.slice(startIdx, i).join('\n');
      }
    }
    if (startIdx !== -1) return lines.slice(startIdx).join('\n');
    return null;
  }

  private extractArticleRange(lines: string[], artStart: number, artEnd: number): string | null {
    let startIdx = -1;
    let endIdx = lines.length;
    const artPattern = /^#{1,3}\s+Artikel\s+(\d+)/;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]?.match(artPattern);
      if (!m) continue;
      const num = Number.parseInt(m[1] ?? '0');
      if (num === artStart && startIdx === -1) startIdx = i;
      if (num > artEnd && startIdx !== -1) { endIdx = i; break; }
    }

    if (startIdx === -1) return null;
    return lines.slice(startIdx, endIdx).join('\n');
  }
}
