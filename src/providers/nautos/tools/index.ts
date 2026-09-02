import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/types.js';
import {
  providerIdSchema,
  resultLimitSchema,
  savePathSchema,
  searchQuerySchema,
  sectionSelectorSchema,
} from '../../../shared/tool-inputs.js';

export const nautosTools: ToolDefinition[] = [
  {
    name: 'nautos_search',
    description:
      'Search DIN/EN/ISO technical standards on nautos.de by document number. ' +
      'Returns acCode, document number, title, date, and document type. ' +
      'Use nautos_get_document with the acCode to retrieve content.',
    inputSchema: z.object({
      query: searchQuerySchema.describe('Document number to search for (e.g., "DIN EN ISO 9001", "DIN 4109")'),
      limit: resultLimitSchema.optional().default(10).describe('Max results (default: 10)'),
    }),
  },
  {
    name: 'nautos_get_document',
    description:
      'Retrieve a DIN/EN/ISO standard by acCode (from nautos_search). ' +
      'Returns outline (metadata + table of contents) by default. ' +
      'Use `section` to fetch a specific section by ID (e.g., "sub-4.1", "sub-a.1", "foreword.nat"). ' +
      'Use `save_path` to save the full document to a file.',
    inputSchema: z.object({
      acCode: providerIdSchema.regex(/^[A-Za-z0-9._-]+$/, 'Invalid nautos document identifier')
        .describe('Document identifier from search results (e.g., "DE30062916")'),
      section: sectionSelectorSchema.optional().describe('Section ID from TOC (e.g., "sub-4.1", "title.nat") or "lines:100-200"'),
      save_path: savePathSchema.optional().describe('Absolute file path for the full document. Relative paths are not supported.'),
    }),
  },
];
