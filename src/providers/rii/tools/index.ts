import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/types.js';
import { SEARCH_FORMAT_DESCRIPTION } from '../../../shared/search-format.js';
import {
  pageNumberSchema,
  providerIdSchema,
  resultLimitSchema,
  savePathSchema,
  searchQuerySchema,
  sectionSelectorSchema,
} from '../../../shared/tool-inputs.js';

const DECISION_SOURCES = ['BUND', 'BY', 'NW', 'NI', 'BB', 'HB', 'SN', 'BW', 'BE', 'HH', 'MV', 'RP', 'SL', 'ST', 'SH', 'TH', 'HE'] as const;
const DECISION_SEARCH_SOURCES = [...DECISION_SOURCES, 'ALL'] as const;

export const riiTools: ToolDefinition[] = [
  {
    name: 'rii_search',
    description:
      'Search for court decisions. Default source "bund": federal courts (BVerfG, BGH, BVerwG, BFH, BAG, BSG, BPatG). ' +
      'Source "BY": Bavarian state courts. Sources "NW", "NI" and "BB" use the official NRW, NI-VORIS and Brandenburg decision databases. Sources BW, BE, HH, MV, RP, SL, ST, SH, TH, HE use the official jPortal state decision portals. ' +
      'Returns list of decisions with metadata and doc IDs for retrieval.',
    inputSchema: z.object({
      query: searchQuerySchema.describe('Search query. For file numbers (Aktenzeichen): use ONLY the file number without keywords (e.g., "I ZR 115/16"). For topics: keywords (e.g., "Metall auf Metall", "BGB § 823").'),
      limit: resultLimitSchema.optional().default(10).describe('Maximum number of results (default: 10). With source "ALL" the slots are shared across the portals that matched, so no single portal can fill the page on its own.'),
      source: z.enum(DECISION_SEARCH_SOURCES).optional().default('BUND').describe('Decision source: BUND, BY, NW, a jPortal state code, or ALL for a consolidated cross-portal search. Note that BUND covers only the federal courts — state Arbeits-, Verwaltungs- and Oberlandesgerichte live in the state sources, so "ALL" is the right choice for a topic survey.'),
      format: z.enum(['compact', 'compact-json']).optional().default('compact').describe(SEARCH_FORMAT_DESCRIPTION),
      include_snippets: z.boolean().optional().default(false).describe('Include the matched-text excerpt per result. Off by default: the metadata columns are normally enough to pick which decision to retrieve, and snippets dominate the response size.'),
      page: pageNumberSchema.optional().default(1).describe('1-based page. Each portal is asked for its own page N, so paging a consolidated search goes deeper into every portal at once. BUND, HB and SN cannot page — the summary names any portal that could not reach the requested page rather than silently repeating page 1.'),
      collapse_duplicates: z.boolean().optional().default(true).describe('Fold runs of near-identical decisions from one court — mass litigation such as the BGH Diesel series — into their newest member. What was folded is always named in the summary, with the file numbers, so nothing is hidden. Set false to list every decision separately.'),
    }),
  },
  {
    name: 'rii_get_decision',
    description:
      'Retrieve full text of a court decision by doc ID. ' +
      'Returns decision in Markdown format with metadata (court, date, file number, ECLI). ' +
      'Use source "BY" for IDs from gesetze-bayern.de (format: Y-300-Z-...).',
    inputSchema: z.object({
      doc_id: providerIdSchema.describe('Document ID from search results (e.g., "jb-KORE704442026" for BUND, "Y-300-Z-GRURRS-B-2021-N-55699" for BY)'),
      part: z.enum(['K', 'L']).optional().default('L').describe('K = Kurztext (summary), L = Langtext (full text, default). Only for source "BUND".'),
      save_path: savePathSchema.optional().describe('Absolute file path for the full document. Relative paths are not supported. Returns metadata only.'),
      source: z.enum(DECISION_SOURCES).optional().default('BUND').describe('Decision source: BUND, BY, NW, or a jPortal state code.'),
      section: sectionSelectorSchema.optional().describe('Section heading or "lines:100-200". Only for source "BY".'),
    }),
  },
];
