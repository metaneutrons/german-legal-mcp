import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/types.js';
import { STATES } from '../types.js';
import {
  providerIdSchema,
  resultLimitSchema,
  savePathSchema,
  searchQuerySchema,
  sectionSelectorSchema,
} from '../../../shared/tool-inputs.js';

const stateEnum = z.enum(STATES);

export const legisTools: ToolDefinition[] = [
  {
    name: 'legis_search',
    description:
      'Search German state legislation (Landesrecht) by keyword. ' +
      'Returns results with IDs for retrieval via legis_get. ' +
      'Official abbreviations such as "HKG" or "PolG" are often more reliable than descriptive phrases. ' +
      'Covers all 16 Bundesländer. BUND does not support search — use legis_get directly.',
    inputSchema: z.object({
      query: searchQuerySchema.describe('Search query (e.g., "Polizeigesetz", "Schulgesetz", "PolG")'),
      state: stateEnum.describe('State code (e.g., "BW", "BY", "NW"). Not "BUND" — federal law has no search.'),
      limit: resultLimitSchema.optional().default(10).describe('Maximum number of results (default: 10)'),
    }),
  },
  {
    name: 'legis_get',
    description:
      'Retrieve a specific law/norm from German federal or state legislation. ' +
      'BUND: id is "law/section" — law is the lowercase abbreviation (e.g. "bgb", "gg", "stgb"), section is just the number. ' +
      'An optional "§", "Art.", "Paragraph", or "Para." prefix on the section is stripped automatically, so "bgb/823", "bgb/§ 823", and "bgb/§823" are equivalent; ' +
      'use whichever prefix matches the document type (§ for codes, Art. for the Grundgesetz). ' +
      'Not every law is hosted under its plain abbreviation on gesetze-im-internet.de — some reissued laws use a different URL slug. ' +
      'If this returns "not found", a subscription provider that resolves abbreviations through its own index may still find it. ' +
      'Länder: id from legis_search results (format varies by state).',
    inputSchema: z.object({
      id: providerIdSchema.describe('Document ID. BUND: "law/section" (e.g., "bgb/823", "gg/Art. 1"). Länder: ID from legis_search.'),
      state: stateEnum.describe('Jurisdiction (e.g., "BUND", "BW", "NW")'),
      save_path: savePathSchema.optional().describe('Absolute file path for the full document. Relative paths are not supported.'),
    }),
  },
  {
    name: 'legis_toc',
    description:
      'Get table of contents for a law — compact list of section numbers and headings. ' +
      'Much lighter than legis_get for navigating large laws. ' +
      'BUND: id is just the law abbreviation (e.g., "bgb", "stgb"). ' +
      'Länder: id from legis_search results.',
    inputSchema: z.object({
      id: providerIdSchema.describe('Law identifier. BUND: law abbreviation (e.g., "bgb"). Länder: ID from legis_search.'),
      state: stateEnum.describe('Jurisdiction (e.g., "BUND", "BW", "NW")'),
      from: sectionSelectorSchema.optional().describe('Start at section (e.g., "§ 823", "Art 1"). Inclusive.'),
      to: sectionSelectorSchema.optional().describe('End at section (e.g., "§ 853"). Inclusive.'),
      depth: z.number().int().min(0).max(10).optional().describe('Max depth level (0=top structure only, 1=sections, 2=subsections, 3=norms)'),
    }),
  },
  {
    name: 'legis_states',
    description: 'List all 17 available German jurisdictions (BUND + 16 Bundesländer) with their backends.',
    inputSchema: z.object({}),
  },
];
