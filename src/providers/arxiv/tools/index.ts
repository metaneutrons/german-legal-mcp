import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/types.js';
import { ARXIV_ID_PATTERN } from '../network-policy.js';
import {
  resultLimitSchema,
  savePathSchema,
  searchQuerySchema,
  sectionSelectorSchema,
} from '../../../shared/tool-inputs.js';

export const arxivTools: ToolDefinition[] = [
  {
    name: 'arxiv_search',
    description:
      'Search arXiv preprints by keywords, author, or category. ' +
      'Returns metadata: arXiv ID, title, authors, abstract, categories, PDF/HTML links. ' +
      'Use arxiv_get with the arXiv ID to retrieve full text.',
    inputSchema: z.object({
      query: searchQuerySchema.describe('Search query. Prefix with field: all:, ti:, au:, abs:, cat: (e.g., "ti:copyright AND cat:cs.CY")'),
      limit: resultLimitSchema.optional().default(10).describe('Max results (default: 10)'),
      start: z.number().int().min(0).max(1_000_000).optional().default(0).describe('Offset for pagination'),
      sort_by: z.enum(['relevance', 'lastUpdatedDate', 'submittedDate']).optional().describe('Sort order'),
    }),
  },
  {
    name: 'arxiv_get',
    description:
      'Retrieve an arXiv paper by ID (e.g., "2501.02725"). ' +
      'Default: metadata + abstract. With `section` or `save_path`: fetches HTML full text (available for papers from ~2024+). ' +
      'Older papers without HTML return metadata + abstract + PDF link.',
    inputSchema: z.object({
      id: z.string().regex(ARXIV_ID_PATTERN, 'Invalid arXiv identifier')
        .describe('arXiv ID (e.g., "2501.02725", "2501.02725v5")'),
      section: sectionSelectorSchema.optional().describe('Section heading or "lines:100-200". Triggers full text fetch.'),
      save_path: savePathSchema.optional().describe('Absolute file path for the full text. Relative paths are not supported. Triggers full text fetch.'),
    }),
  },
];
