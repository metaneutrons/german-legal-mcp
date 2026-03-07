import axios from 'axios';
import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { rootLogger } from '../../shared/logger.js';
import { IcuConverter } from './converter.js';
import { icuTools } from './tools/index.js';

const logger = rootLogger.child({ module: 'icu-provider' });

const SEARCH_URL = 'https://infocuriaws.curia.europa.eu/elastic-connector/search';
const BLOB_URL = 'https://infocuriaws.curia.europa.eu/blob/download-file';
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Accept': 'application/json',
  'Origin': 'https://infocuria.curia.europa.eu',
};

export class IcuProvider implements Provider {
  readonly name = 'icu';
  private converter: IcuConverter;

  constructor() {
    this.converter = new IcuConverter();
  }

  getTools(): ToolDefinition[] {
    return icuTools;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName === 'icu:search') return this.handleSearch(args);
    if (toolName === 'icu:get_document') return this.handleGetDocument(args);
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }

  async shutdown(): Promise<void> {
    logger.info('ICU provider shutdown');
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const { query, language = 'DE', limit = 10 } = args as { query: string; language?: string; limit?: number };

    try {
      logger.info('Searching InfoCuria', { query, language });

      const response = await axios.post(SEARCH_URL, {
        searchTerm: query,
        multiSearchTerms: [],
        sortTermList: [{ sortDirection: 'DESC', sortTerm: 'ALL_DATES' }],
        pagination: { pageNumber: 0, pageSize: limit, from: 1, to: limit * 2 },
        language: language.toUpperCase(),
        tabName: 'tout_jurisprudence',
        isAllTabsRequest: false,
        isSearchExact: true,
        searchSources: ['document', 'metadata'],
        ecli: '', publishedId: '', usualName: '', logicDocId: '',
      }, { headers: HEADERS });

      const hits = response.data.searchHits || [];
      const markdown = hits.map((hit: any, i: number) => {
        const c = hit.content;
        return `${i + 1}. **${c.docType}, ${c.docDate}, ${c.idPublished}**\n` +
          `   - ECLI: ${c.ecli || 'n/a'}\n` +
          `   - CELEX: \`${c.celex}\`\n` +
          `   - Court: ${c.affairJurisdiction}\n` +
          `   - Logic Doc ID: \`${c.logicDocId}\``;
      }).join('\n\n');

      return {
        content: [{ type: 'text', text: `Found ${response.data.totalHits} results (showing ${hits.length}):\n\n${markdown}` }],
      };
    } catch (error) {
      logger.error('Search failed', error as Error, { query });
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }

  private async handleGetDocument(args: Record<string, unknown>): Promise<ToolResult> {
    const { case_id, language = 'DE', section, save_path } = args as {
      case_id: string; language?: string; section?: string; save_path?: string;
    };

    try {
      // Resolve case_id to logicDocId via search
      const logicDocId = await this.resolveLogicDocId(case_id, language as string);
      if (!logicDocId) {
        return { content: [{ type: 'text', text: `No document found for "${case_id}" in ${language}` }], isError: true };
      }

      const numericId = logicDocId.replace('id_', '');
      logger.info('Fetching document', { case_id, numericId, language });

      const response = await axios.get(`${BLOB_URL}/${numericId}/${language.toUpperCase()}/html`, {
        headers: { 'Origin': 'https://infocuria.curia.europa.eu' },
        responseType: 'text',
      });

      const markdown = this.converter.convert(response.data);

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
        const { writeFile } = await import('fs/promises');
        await writeFile(save_path, fullDoc, 'utf-8');
        return { content: [{ type: 'text', text: `Saved to ${save_path}\n\nCase: ${case_id}\nLanguage: ${language}` }] };
      }

      return { content: [{ type: 'text', text: fullDoc }] };
    } catch (error) {
      logger.error('Failed to get document', error as Error, { case_id });
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }

  private async resolveLogicDocId(caseId: string, language: string): Promise<string | null> {
    // If already a logicDocId (id_123456)
    if (caseId.startsWith('id_')) return caseId;

    // If numeric, assume it's the numeric part
    if (/^\d+$/.test(caseId)) return `id_${caseId}`;

    // Search by publishedId (e.g., "C-476/17") or CELEX
    const isCelex = /^\d{5}[A-Z]{2}\d+$/.test(caseId);
    const body: any = {
      searchTerm: isCelex ? '' : '',
      multiSearchTerms: [],
      sortTermList: [{ sortDirection: 'DESC', sortTerm: 'ALL_DATES' }],
      pagination: { pageNumber: 0, pageSize: 1, from: 1, to: 2 },
      language: language.toUpperCase(),
      tabName: 'tout_jurisprudence',
      isAllTabsRequest: false,
      isSearchExact: true,
      searchSources: ['document', 'metadata'],
      ecli: '', publishedId: '', usualName: '', logicDocId: '',
    };

    if (isCelex) {
      body.searchTerm = caseId;
    } else {
      body.publishedId = caseId;
    }

    const response = await axios.post(SEARCH_URL, body, { headers: HEADERS });
    const hits = response.data.searchHits || [];
    if (hits.length === 0) return null;
    return hits[0].content.logicDocId || null;
  }

  private extractSection(markdown: string, section: string): string | null {
    const lines = markdown.split('\n');

    // lines:100-200
    const lineMatch = section.match(/^lines?:(\d+)-(\d+)$/i);
    if (lineMatch) {
      const start = Math.max(1, parseInt(lineMatch[1])) - 1;
      const end = Math.min(lines.length, parseInt(lineMatch[2]));
      return lines.slice(start, end).join('\n');
    }

    // Rn 5 or Rn 5-12
    const rnMatch = section.match(/^Rn\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?$/i);
    if (rnMatch) {
      const rnStart = parseInt(rnMatch[1]);
      const rnEnd = rnMatch[2] ? parseInt(rnMatch[2]) : rnStart;
      let startIdx = -1;
      let endIdx = lines.length;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\[Rn\.\s*(\d+)\]\{\.rn\}/);
        if (!m) continue;
        const rn = parseInt(m[1]);
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
      const hm = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (!hm) continue;
      const level = hm[1].length;
      const text = hm[2].toLowerCase();
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

