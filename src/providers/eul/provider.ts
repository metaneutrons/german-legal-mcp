import axios from 'axios';
import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { rootLogger } from '../../shared/logger.js';
import { EulConverter } from './converter.js';
import { eulTools } from './tools/index.js';

const logger = rootLogger.child({ module: 'eul-provider' });

const CELLAR_BASE = 'http://publications.europa.eu/resource/celex';
const SPARQL_URL = 'http://publications.europa.eu/webapi/rdf/sparql';

const LANG_MAP: Record<string, string> = {
  DE: 'DEU', EN: 'ENG', FR: 'FRA', IT: 'ITA', ES: 'SPA', NL: 'NLD', PT: 'POR', PL: 'POL',
};

const RESOURCE_TYPES: Record<string, string> = {
  directive: 'DIR', regulation: 'REG', decision: 'DEC', treaty: 'TREATY',
};

export class EulProvider implements Provider {
  readonly name = 'eul';
  private converter: EulConverter;

  constructor() {
    this.converter = new EulConverter();
  }

  getTools(): ToolDefinition[] {
    return eulTools;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName === 'eul:search') return this.handleSearch(args);
    if (toolName === 'eul:get_document') return this.handleGetDocument(args);
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }

  async shutdown(): Promise<void> {
    logger.info('ELU provider shutdown');
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const { query, resource_type = 'any', language = 'DE', limit = 10 } = args as {
      query: string; resource_type?: string; language?: string; limit?: number;
    };

    const lang3 = LANG_MAP[language.toUpperCase()] || 'DEU';

    let typeFilter = '';
    if (resource_type !== 'any' && RESOURCE_TYPES[resource_type]) {
      typeFilter = `?work cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/${RESOURCE_TYPES[resource_type]}> .`;
    }

    const sparql = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?title WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  ${typeFilter}
  ?expr cdm:expression_belongs_to_work ?work .
  ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${lang3}> .
  ?expr cdm:expression_title ?title .
  FILTER(CONTAINS(LCASE(?title), LCASE("${query.replace(/"/g, '\\"')}")))
} LIMIT ${limit}`;

    try {
      logger.info('Searching EUR-Lex', { query, resource_type });
      const response = await axios.get(SPARQL_URL, {
        params: { query: sparql },
        headers: { 'Accept': 'application/sparql-results+json' },
      });

      const bindings = response.data.results?.bindings || [];
      const markdown = bindings.map((b: any, i: number) =>
        `${i + 1}. **${b.celex.value}**\n   ${b.title.value.slice(0, 200)}${b.title.value.length > 200 ? '…' : ''}`
      ).join('\n\n');

      return {
        content: [{ type: 'text', text: `Found ${bindings.length} results:\n\n${markdown}` }],
      };
    } catch (error) {
      logger.error('Search failed', error as Error, { query });
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }

  private async handleGetDocument(args: Record<string, unknown>): Promise<ToolResult> {
    const { celex, language = 'DE', section, save_path } = args as {
      celex: string; language?: string; section?: string; save_path?: string;
    };

    try {
      logger.info('Fetching EUR-Lex document', { celex, language });

      const response = await axios.get(`${CELLAR_BASE}/${celex}`, {
        headers: {
          'Accept': 'text/html, application/xhtml+xml',
          'Accept-Language': `${language.toLowerCase()}, en;q=0.8`,
        },
        maxRedirects: 5,
        responseType: 'text',
      });

      const markdown = this.converter.convert(response.data);

      if (section) {
        const extracted = this.extractSection(markdown, section);
        if (!extracted) {
          return { content: [{ type: 'text', text: `Section "${section}" not found.` }], isError: true };
        }
        return { content: [{ type: 'text', text: extracted }] };
      }

      const fullDoc = `# ${celex}\n\n---\n\n${markdown}`;

      if (save_path) {
        const { writeFile } = await import('fs/promises');
        await writeFile(save_path, fullDoc, 'utf-8');
        return { content: [{ type: 'text', text: `Saved to ${save_path}\n\nCELEX: ${celex}\nLanguage: ${language}` }] };
      }

      return { content: [{ type: 'text', text: fullDoc }] };
    } catch (error) {
      logger.error('Failed to get document', error as Error, { celex });
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
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

    // Art. 5 or Artikel 5 or Artikel 5-10
    const artMatch = section.match(/^Art(?:ikel)?\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?$/i);
    if (artMatch) {
      const artStart = parseInt(artMatch[1]);
      const artEnd = artMatch[2] ? parseInt(artMatch[2]) : artStart;
      return this.extractArticleRange(lines, artStart, artEnd);
    }

    // Heading match (Kapitel, Abschnitt, etc.)
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

  private extractArticleRange(lines: string[], artStart: number, artEnd: number): string | null {
    let startIdx = -1;
    let endIdx = lines.length;
    const artPattern = /^#{1,3}\s+Artikel\s+(\d+)/;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(artPattern);
      if (!m) continue;
      const num = parseInt(m[1]);
      if (num === artStart && startIdx === -1) startIdx = i;
      if (num > artEnd && startIdx !== -1) { endIdx = i; break; }
    }

    if (startIdx === -1) return null;
    return lines.slice(startIdx, endIdx).join('\n');
  }
}

