import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/types.js';

export const riiTools: ToolDefinition[] = [
  {
    name: 'rii:search',
    description:
      'Search for court decisions in Rechtsprechung im Internet (federal German courts: BVerfG, BGH, BVerwG, BFH, BAG, BSG, BPatG). ' +
      'Returns list of decisions with metadata and doc IDs for retrieval.',
    inputSchema: z.object({
      query: z.string().describe('Search query (e.g., "Metall auf Metall", "Datenschutz", "BGB § 823")'),
      limit: z.number().optional().default(10).describe('Maximum number of results (default: 10)'),
    }),
  },
  {
    name: 'rii:get_decision',
    description:
      'Retrieve full text of a court decision from Rechtsprechung im Internet by doc ID. ' +
      'Returns decision in Markdown format with metadata (court, date, file number, ECLI).',
    inputSchema: z.object({
      doc_id: z.string().describe('Document ID from search results (e.g., "jb-KORE704442026")'),
      part: z.enum(['K', 'L']).optional().default('L').describe('K = Kurztext (summary), L = Langtext (full text, default)'),
      save_path: z.string().optional().describe('Save full document to this file path instead of returning content. Returns metadata only.'),
    }),
  },
];
