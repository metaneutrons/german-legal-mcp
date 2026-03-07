import axios, { AxiosInstance } from 'axios';
import { writeFile } from 'fs/promises';
import { z } from 'zod';
import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { RisConverter } from './converter.js';

const BASE_URL = 'https://testphase.rechtsinformationen.bund.de/v1';

export type DocumentType = 'legislation' | 'caselaw' | 'literature' | 'administrativedirective';
export type OutputFormat = 'markdown' | 'html' | 'xml';

export interface SearchFilters {
  court?: string;
  dateFrom?: string;
  dateTo?: string;
  [key: string]: string | undefined;
}

class RisProvider implements Provider {
  readonly name = 'ris';
  private client: AxiosInstance;
  private converter: RisConverter;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
      },
    });
    this.converter = new RisConverter();
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'ris:search',
        description: 'Search across German Federal Legal Information Portal (RIS) document types (legislation, caselaw, literature, administrative directives). Returns metadata and snippets only.',
        inputSchema: z.object({
          query: z.string().describe('Search term'),
          documentType: z.enum(['legislation', 'caselaw', 'literature', 'administrativedirective']).optional().describe('Filter by document type'),
          limit: z.number().optional().default(10).describe('Results per page'),
          page: z.number().optional().default(1).describe('Page number'),
          filters: z.record(z.string(), z.string()).optional().describe('Additional filters (court, dateFrom, dateTo, etc.)'),
        }),
      },
      {
        name: 'ris:get_document',
        description: 'Retrieve a document from German Federal Legal Information Portal (RIS). Returns outline by default; use section for specific parts, save_path to save full document.',
        inputSchema: z.object({
          id: z.string().describe('Document ID (ELI/ECLI/ID)'),
          documentType: z.enum(['legislation', 'caselaw', 'literature', 'administrativedirective']).describe('Document type'),
          section: z.string().optional().describe('Extract specific section (heading text, § number, or lines:N-M)'),
          format: z.enum(['markdown', 'html', 'xml']).optional().default('markdown').describe('Output format'),
          save_path: z.string().optional().describe('Save full document to file and return metadata only'),
        }),
      },
      {
        name: 'ris:get_legislation',
        description: 'Retrieve legislation by ELI. Same two-phase pattern as get_document.',
        inputSchema: z.object({
          eli: z.string().describe('European Legislation Identifier (e.g., "bgb")'),
          article: z.string().optional().describe('Specific article/paragraph (e.g., "823" for § 823)'),
          format: z.enum(['markdown', 'html', 'xml']).optional().default('markdown').describe('Output format'),
          save_path: z.string().optional().describe('Save full document to file'),
        }),
      },
      {
        name: 'ris:get_caselaw',
        description: 'Retrieve case law by ECLI. Same two-phase pattern as get_document.',
        inputSchema: z.object({
          ecli: z.string().describe('European Case Law Identifier'),
          section: z.string().optional().describe('Extract specific section'),
          format: z.enum(['markdown', 'html', 'xml']).optional().default('markdown').describe('Output format'),
          save_path: z.string().optional().describe('Save full document to file'),
        }),
      },
      {
        name: 'ris:list_courts',
        description: 'List available courts in the German Federal Legal Information Portal (RIS) database.',
        inputSchema: z.object({
          query: z.string().optional().describe('Filter courts by name'),
        }),
      },
      {
        name: 'ris:get_statistics',
        description: 'Get German Federal Legal Information Portal (RIS) API statistics (document counts, etc.).',
        inputSchema: z.object({}).optional(),
      },
    ];
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'ris:search':
          return await this.handleSearch(args);
        case 'ris:get_document':
          return await this.handleGetDocument(args);
        case 'ris:get_legislation':
          return await this.handleGetLegislation(args);
        case 'ris:get_caselaw':
          return await this.handleGetCaselaw(args);
        case 'ris:list_courts':
          return await this.handleListCourts(args);
        case 'ris:get_statistics':
          return await this.handleGetStatistics(args);
        default:
          return {
            content: [{ type: 'text', text: `Tool not implemented: ${toolName}` }],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const { query, documentType, limit = 10, page = 1, filters } = args;
    
    if (!query || typeof query !== 'string') {
      return {
        content: [{ type: 'text', text: 'Error: query parameter is required and must be a string' }],
        isError: true,
      };
    }
    
    const data = await this.search(
      query,
      documentType as DocumentType | undefined,
      limit as number,
      page as number,
      filters as SearchFilters | undefined
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  }

  private async handleGetDocument(args: Record<string, unknown>): Promise<ToolResult> {
    const { id, documentType, section, format = 'markdown', save_path } = args;

    if (!id || typeof id !== 'string') {
      return {
        content: [{ type: 'text', text: 'Error: id parameter is required and must be a string' }],
        isError: true,
      };
    }
    
    if (!documentType || typeof documentType !== 'string') {
      return {
        content: [{ type: 'text', text: 'Error: documentType parameter is required' }],
        isError: true,
      };
    }

    // Fetch metadata
    const metadata = await this.getDocument(id as string, documentType as DocumentType, 'json') as Record<string, unknown>;

    // Fetch HTML for conversion
    const html = await this.getDocument(id as string, documentType as DocumentType, 'html') as string;

    // Handle save_path
    if (save_path) {
      const content = format === 'xml'
        ? await this.getDocument(id as string, documentType as DocumentType, 'xml') as string
        : format === 'html'
        ? html
        : this.converter.convertToMarkdown(html);

      await writeFile(save_path as string, content as string);
      return {
        content: [{ type: 'text', text: `Document saved to ${save_path}\n\n${JSON.stringify(this.converter.extractMetadata(metadata), null, 2)}` }],
        isError: false,
      };
    }

    // Handle section extraction
    if (section) {
      const extracted = this.converter.extractSection(html, section as string);
      if (!extracted) {
        return {
          content: [{ type: 'text', text: `Section "${section}" not found` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: extracted }],
        isError: false,
      };
    }

    // Return outline
    const outline = this.converter.generateOutline(metadata, html);
    return {
      content: [{ type: 'text', text: outline }],
      isError: false,
    };
  }

  private async handleGetLegislation(args: Record<string, unknown>): Promise<ToolResult> {
    const { eli, article, format = 'markdown', save_path } = args;

    if (article) {
      const html = await this.getArticle(eli as string, article as string);
      const markdown = this.converter.convertToMarkdown(html);
      return {
        content: [{ type: 'text', text: markdown }],
        isError: false,
      };
    }

    return this.handleGetDocument({ id: eli, documentType: 'legislation', format, save_path });
  }

  private async handleGetCaselaw(args: Record<string, unknown>): Promise<ToolResult> {
    return this.handleGetDocument({ ...args, id: args.ecli, documentType: 'caselaw' });
  }

  private async handleListCourts(args: Record<string, unknown>): Promise<ToolResult> {
    const { query } = args;
    const data = await this.listCourts(query as string | undefined);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  }

  private async handleGetStatistics(_args: Record<string, unknown>): Promise<ToolResult> {
    const data = await this.getStatistics();
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for HTTP client
  }

  // HTTP methods
  private async search(
    query: string,
    documentType?: DocumentType,
    limit = 10,
    page = 1,
    filters?: SearchFilters
  ): Promise<Record<string, unknown>> {
    const endpoint = documentType ? `/${documentType}` : '/document';
    const params: Record<string, unknown> = {
      searchTerm: query,
      size: limit,
      page: page - 1,
      ...filters,
    };

    const response = await this.client.get(endpoint, { params });
    return response.data as Record<string, unknown>;
  }

  private async getDocument(
    id: string,
    documentType: DocumentType,
    format: 'json' | 'html' | 'xml' = 'json'
  ): Promise<unknown> {
    const endpoint = this.buildDocumentEndpoint(id, documentType, format);
    const response = await this.client.get(endpoint, {
      headers: format === 'json' ? {} : { 'Accept': this.getAcceptHeader(format) },
      responseType: format === 'json' ? 'json' : 'text',
    });
    return response.data;
  }

  private async getArticle(eli: string, article: string): Promise<string> {
    const endpoint = `/legislation/${eli}/principal/article/${article}/html`;
    const response = await this.client.get(endpoint, {
      headers: { 'Accept': 'text/html' },
      responseType: 'text',
    });
    return response.data as string;
  }

  private async listCourts(query?: string): Promise<Record<string, unknown>> {
    const params = query ? { searchTerm: query } : {};
    const response = await this.client.get('/courts', { params });
    return response.data as Record<string, unknown>;
  }

  private async getStatistics(): Promise<Record<string, unknown>> {
    const response = await this.client.get('/statistics');
    return response.data as Record<string, unknown>;
  }

  private buildDocumentEndpoint(id: string, type: DocumentType, format: 'json' | 'html' | 'xml'): string {
    const base = `/${type}/${id}`;
    if (format === 'json') return base;
    
    const subtype = type === 'legislation' ? '/principal' : '';
    return `${base}${subtype}/${format}`;
  }

  private getAcceptHeader(format: 'html' | 'xml'): string {
    return format === 'html' ? 'text/html' : 'application/xml';
  }
}

export { RisProvider };
export const risProvider = new RisProvider();
