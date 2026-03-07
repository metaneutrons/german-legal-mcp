import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/types.js';

export const eulTools: ToolDefinition[] = [
  {
    name: 'eul:search',
    description:
      'Search EU legislation (directives, regulations, treaties) via EUR-Lex SPARQL endpoint. ' +
      'Returns CELEX numbers, titles, and dates.',
    inputSchema: z.object({
      query: z.string().describe('Search term in title (e.g., "Urheberrecht", "Datenschutz", "Verbraucherschutz")'),
      resource_type: z.enum(['any', 'directive', 'regulation', 'decision', 'treaty']).optional().default('any')
        .describe('Filter by type (default: any)'),
      language: z.string().optional().default('DE').describe('Language code (default: DE)'),
      limit: z.number().optional().default(10).describe('Maximum results (default: 10)'),
    }),
  },
  {
    name: 'eul:get_document',
    description:
      'Retrieve EU legislation from EUR-Lex by CELEX number (e.g., "32016R0679" for GDPR, "32001L0029" for InfoSoc). ' +
      'Returns full text in Markdown. Use `section` for partial content: "Art. 5", "Artikel 5", or "lines:100-200". ' +
      'Use `save_path` to save to file instead of returning content.',
    inputSchema: z.object({
      celex: z.string().describe('CELEX number (e.g., "32016R0679", "32001L0029", "12016E267")'),
      language: z.string().optional().default('DE').describe('Language code (default: DE)'),
      section: z.string().optional().describe('Extract section: "Art. 5", "Artikel 5-10", "Kapitel III", or "lines:100-200"'),
      save_path: z.string().optional().describe('Save full document to this file path instead of returning content'),
    }),
  },
];
