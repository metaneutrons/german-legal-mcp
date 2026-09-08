import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { rootLogger } from '../../shared/logger.js';
import { IcuConverter } from './converter.js';
import { validateConversion } from '../../shared/converter.js';
import { saveToFile } from '../../shared/save-to-file.js';
import { icuTools } from './tools/index.js';
import { IcuDataClient } from './data-client.js';
import { normalizeToolName } from '../../shared/tool-names.js';

const logger = rootLogger.child({ module: 'icu-provider' });

export class IcuProvider implements Provider {
  readonly name = 'icu';
  private readonly client: IcuDataClient;

  constructor(
    clientOrHttp: IcuDataClient | Pick<AxiosInstance, 'get' | 'post'> = axios,
    converter: IcuConverter = new IcuConverter(),
  ) {
    this.client = clientOrHttp instanceof IcuDataClient
      ? clientOrHttp
      : new IcuDataClient(clientOrHttp, converter);
  }

  getTools(): ToolDefinition[] {
    return icuTools;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const canonicalName = normalizeToolName(toolName);
    if (canonicalName === 'icu_search') return this.handleSearch(args);
    if (canonicalName === 'icu_get_document') return this.handleGetDocument(args);
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }

  async shutdown(): Promise<void> {
    logger.info('ICU provider shutdown');
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const { query, language = 'DE', limit = 10 } = args as { query: string; language?: string; limit?: number };

    logger.info('Searching InfoCuria', { queryLength: query.length, language });

    const response = await this.client.searchCaseLaw(query, language, limit);
    const markdown = response.hits.map((c, i) => {
      return `${i + 1}. **${c.docType}, ${c.docDate}, ${c.idPublished}**\n` +
        `   - ECLI: ${c.ecli || 'n/a'}\n` +
        `   - CELEX: \`${c.celex}\`\n` +
        `   - Court: ${c.affairJurisdiction}\n` +
        `   - Logic Doc ID: \`${c.logicDocId}\``;
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Found ${response.totalHits} results (showing ${response.hits.length}):\n\n${markdown}` }],
    };
  }

  private async handleGetDocument(args: Record<string, unknown>): Promise<ToolResult> {
    const { case_id, language = 'DE', section, save_path } = args as {
      case_id: string; language?: string; section?: string; save_path?: string;
    };

    // Resolve case_id to logicDocId via search
    const result = await this.client.getCaseLaw(case_id, language as string);
    if (!result) {
      return { content: [{ type: 'text', text: `No document found for "${case_id}" in ${language}` }], isError: true };
    }

    logger.info('Fetching document', { case_id, logicDocId: result.logicDocId, language });
    const markdown = result.markdown;
    validateConversion(markdown, 'InfoCuria');

    // Section extraction
    if (section) {
      const extracted = this.extractSection(markdown, section);
      if (!extracted) {
        return { content: [{ type: 'text', text: `Section "${section}" not found.` }], isError: true };
      }
      return { content: [{ type: 'text', text: extracted }] };
    }

    const fullDoc = `# ${case_id}\n\n---\n\n${markdown}`;

    if (save_path) {
      return saveToFile(save_path, fullDoc, `Case: ${case_id}\nLanguage: ${language}`);
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

    // Rn 5 or Rn 5-12
    const rnMatch = section.match(/^Rn\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?$/i);
    if (rnMatch) {
      const rnStart = Number.parseInt(rnMatch[1] ?? '0');
      const rnEnd = rnMatch[2] ? Number.parseInt(rnMatch[2]) : rnStart;
      let startIdx = -1;
      let endIdx = lines.length;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]?.match(/^\[Rn\.\s*(\d+)\]\{\.rn\}/);
        if (!m) continue;
        const rn = Number.parseInt(m[1] ?? '0');
        if (rn === rnStart && startIdx === -1) startIdx = i;
        if (rn > rnEnd && startIdx !== -1) { endIdx = i; break; }
      }
      if (startIdx === -1) return null;
      return lines.slice(startIdx, endIdx).join('\n');
    }

    // Heading match
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
}
