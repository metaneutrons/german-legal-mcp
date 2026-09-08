import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/types.js';
import {
  languageCodeSchema,
  providerIdSchema,
  resultLimitSchema,
  savePathSchema,
  searchQuerySchema,
  sectionSelectorSchema,
} from '../../../shared/tool-inputs.js';

export const icuTools: ToolDefinition[] = [
  {
    name: 'icu_search',
    description:
      'Search for decisions and opinions of the Court of Justice of the European Union (CJEU) via InfoCuria. ' +
      'Returns list with case numbers, ECLI, dates, and document IDs for retrieval.',
    inputSchema: z.object({
      query: searchQuerySchema.describe('Search term (e.g., "Pelham", "Sampling", "Urheberrecht")'),
      language: languageCodeSchema.optional().default('DE').describe('Language code (e.g., "DE", "FR", "EN"). Default: DE'),
      limit: resultLimitSchema.optional().default(10).describe('Maximum number of results (default: 10)'),
    }),
  },
  {
    name: 'icu_get_document',
    description:
      'Retrieve a CJEU decision or opinion from InfoCuria by published case number, CELEX number or Logic Doc ID. ' +
      'Returns full text in Markdown with Randnummern as [Rn. 5]{.rn}. ' +
      'A published case number (e.g., "C-476/17", "T-108/25") is converted to its CELEX form internally, so all three forms work. ' +
      'A CELEX number (e.g., "62017CJ0476") or the "Logic Doc ID" from an icu_search result (e.g., "id_320668") resolve with one request fewer. ' +
      'Use `section` for partial content: "Rn 5-12", heading text, or "lines:100-200". ' +
      'Use `save_path` when you want the document written to a file for later use outside this conversation.',
    inputSchema: z.object({
      case_id: providerIdSchema.describe('Published case number (e.g., "C-476/17"), CELEX number (e.g., "62017CJ0476") or "Logic Doc ID" from an icu_search result (e.g., "id_320668").'),
      language: languageCodeSchema.optional().default('DE').describe('Language code (default: DE)'),
      section: sectionSelectorSchema.optional().describe('Extract section: "Rn 5-12", heading text, or "lines:100-200"'),
      save_path: savePathSchema.optional().describe('Absolute file path for the full document. Relative paths are not supported.'),
    }),
  },
];
