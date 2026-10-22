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
      'Retrieve EU legislation by CELEX number (e.g., "32016R0679" for GDPR, "32024R1689" for the AI Act) from the EU Publications Office (Cellar). ' +
      'A CELEX beginning with the sector digit (3…) returns the act as published in the Official Journal, without later amendments. ' +
      'For the consolidated text use the leading 0 instead: "02024R1689" returns the latest consolidated version in force, "02024R1689-20240712" a specific one; consolidated texts are documentation, not the binding text. ' +
      'Returns full text in Markdown. Use `section` for partial content: "Art. 5", "Artikel 5-10", "Anhang III", "Kapitel III", "Kapitel III Abschnitt 2", or "lines:100-200". ' +
      '`save_path` is for export only — when the user wants the document as a file to keep or process elsewhere.',
    inputSchema: z.object({
      celex: z.string().regex(CELEX_PATTERN, 'Invalid CELEX identifier')
        .describe('CELEX number (e.g., "32016R0679", "32001L0029", "12016E267"; consolidated: "02016R0679" or "02016R0679-20160504")'),
      language: languageCodeSchema.optional().default('DE').describe('Language code (default: DE)'),
      section: sectionSelectorSchema.optional().describe('Extract section: "Art. 5", "Artikel 5-10", "Anhang III" (also "Annex 3"), "Kapitel III" (with all its sections), "Kapitel III Abschnitt 2", or "lines:100-200"'),
      save_path: savePathSchema.optional().describe('Absolute file path for the full document. Relative paths are not supported.'),
    }),
  },
];
