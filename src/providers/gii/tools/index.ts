import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/types.js';

export const giiTools: ToolDefinition[] = [
  {
    name: 'gii:get_legislation',
    description:
      'Retrieve German federal legislation from Gesetze im Internet. ' +
      'Provide law abbreviation (e.g., "BGB", "StGB") and section number (e.g., "§ 823", "823"). ' +
      'Returns the full text of the specified section in Markdown format with navigation links.',
    inputSchema: z.object({
      law: z.string().describe('Law abbreviation (e.g., "BGB", "StGB", "GG")'),
      section: z.string().describe('Section number (e.g., "§ 823", "823", "§ 1")'),
      save_path: z.string().optional().describe('Save full document to this file path instead of returning content. Returns metadata only.'),
    }),
  },
];
