import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/types.js';
import { CELEX_PATTERN } from '../network-policy.js';
import {
  languageCodeSchema,
  resultLimitSchema,
  savePathSchema,
  searchQuerySchema,
  sectionSelectorSchema,
} from '../../../shared/tool-inputs.js';

export const eulTools: ToolDefinition[] = [
  {
    name: 'eul_search',
    description:
      'Search EU legislation (directives, regulations, treaties) via EUR-Lex SPARQL endpoint. ' +
      'Returns CELEX numbers, titles, and dates.',
    inputSchema: z.object({
      query: searchQuerySchema.describe('Search term in title (e.g., "Urheberrecht", "Datenschutz", "Verbraucherschutz")'),
      resource_type: z.enum(['any', 'directive', 'regulation', 'decision', 'treaty']).optional().default('any')
        .describe('Filter by type (default: any)'),
      language: languageCodeSchema.optional().default('DE').describe('Language code (default: DE)'),
      limit: resultLimitSchema.optional().default(10).describe('Maximum results (default: 10)'),
    }),
  },
  {
    name: 'eul_get_document',
    description:
      'Retrieve EU legislation from EUR-Lex by CELEX number (e.g., "32016R0679" for GDPR, "32001L0029" for InfoSoc). ' +
      'Returns full text in Markdown. Use `section` for partial content: "Art. 5", "Artikel 5", or "lines:100-200". ' +
      '`save_path` is for export only — when the user wants the document as a file to keep or process elsewhere.',
    inputSchema: z.object({
      celex: z.string().regex(CELEX_PATTERN, 'Invalid CELEX identifier')
        .describe('CELEX number (e.g., "32016R0679", "32001L0029", "12016E267")'),
      language: languageCodeSchema.optional().default('DE').describe('Language code (default: DE)'),
      section: sectionSelectorSchema.optional().describe('Extract section: "Art. 5", "Artikel 5-10", "Kapitel III", or "lines:100-200"'),
      save_path: savePathSchema.optional().describe('Absolute file path for the full document. Relative paths are not supported.'),
    }),
  },
];
