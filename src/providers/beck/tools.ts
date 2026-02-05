import { z } from 'zod';
import * as cheerio from 'cheerio';
import { ToolDefinition, ToolResult } from '../../shared/types.js';
import { BeckBrowser } from './browser.js';
import { BeckConverter } from './converter.js';

/**
 * Tool definitions for the Beck Online provider.
 * All tools are prefixed with 'beck:' for namespacing.
 */
export const beckToolDefinitions: ToolDefinition[] = [
  {
    name: 'beck:search',
    description: 'Search the Beck Online legal database for laws, cases, and commentaries.',
    inputSchema: z.object({
      query: z.string().describe("Search terms (e.g., 'Urheberrecht', 'BGB § 123')"),
      page: z.number().optional().default(1).describe('Page number'),
      only_available: z.boolean().optional().default(false).describe('Only include results from your active modules/subscriptions'),
      category: z.enum(['Gesetz', 'Rechtsprechung', 'Kommentar', 'Aufsatz', 'Handbuch', 'Formular']).optional().describe('Filter by document type'),
    }),
  },
  {
    name: 'beck:get_document',
    description: 'Retrieve the full content of a document from Beck Online.',
    inputSchema: z.object({
      vpath: z.string().describe('Unique document identifier path (e.g. bibdata/ges/...) or a full Beck Online URL'),
      format: z.enum(['markdown', 'html']).optional().default('markdown').describe('Output format'),
    }),
  },
  {
    name: 'beck:get_legislation',
    description: 'Directly retrieve a specific law/norm from Beck Online (e.g. BGB 823).',
    inputSchema: z.object({
      law_abbreviation: z.string().describe("Law abbreviation (e.g. 'BGB', 'UrhG')"),
      paragraph: z.string().optional().describe("Paragraph number (e.g. '15')"),
    }),
  },
  {
    name: 'beck:resolve_citation',
    description: 'Transform a natural language citation into a canonical Beck Online vpath and title.',
    inputSchema: z.object({
      citation: z.string().describe("The citation string (e.g. 'NJW 2024, 123', '§ 15 UrhG')"),
    }),
  },
  {
    name: 'beck:get_context',
    description: 'Get breadcrumbs and navigation links for a Beck Online document.',
    inputSchema: z.object({
      vpath: z.string().describe('Unique document identifier path'),
    }),
  },
  {
    name: 'beck:get_suggestions',
    description: 'Get autocomplete suggestions for a legal term from Beck Online.',
    inputSchema: z.object({
      term: z.string().describe('Partial term to complete'),
    }),
  },
  {
    name: 'beck:get_referenced_documents',
    description: 'Get list of documents cited in the given Beck Online document.',
    inputSchema: z.object({
      vpath: z.string().describe('Unique document identifier path'),
    }),
  },
];


// Category mapping for search filters
const categoryMap: Record<string, string> = {
  Gesetz: 'spubtyp0:ges',
  Rechtsprechung: 'spubtyp0:ent',
  Kommentar: 'spubtyp0:komm',
  Aufsatz: 'spubtyp0:aufs',
  Handbuch: 'spubtyp0:hdb',
  Formular: 'spubtyp0:form',
};

/**
 * Handle beck:search tool call
 */
async function handleSearch(
  args: Record<string, unknown>,
  browser: BeckBrowser
): Promise<ToolResult> {
  const { query, category, only_available } = args as {
    query: string;
    category?: string;
    only_available?: boolean;
  };
  const page = (args.page as number) || 1;

  let url = `https://beck-online.beck.de/Search?pagenr=${page}&words=${encodeURIComponent(query)}`;

  if (category && categoryMap[category]) {
    url += `&Addfilter=${encodeURIComponent(categoryMap[category])}`;
  }

  if (only_available) {
    url += '&MEINBECKONLINE=True';
  }

  const html = await browser.fetchPage(url);
  const currentUrl = browser.getCurrentUrl();

  // Check if we were redirected directly to a document
  if (currentUrl.includes('/Dokument?')) {
    const vpath = new URL(currentUrl).searchParams.get('vpath');
    if (vpath) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                title: 'Direct Hit (Redirected)',
                type: 'Unknown',
                vpath: vpath,
                link: currentUrl,
              },
            ]),
          },
        ],
      };
    }
  }

  const $ = cheerio.load(html);
  const results: Array<{ title: string; type: string; vpath: string; link: string }> = [];

  $('.treffer-wrapper').each((i, el) => {
    const titleEl = $(el).find('.treffer-firstline-text a');
    const title = titleEl.text().trim();
    const href = titleEl.attr('href');

    if (title && href) {
      const urlObj = new URL('https://beck-online.beck.de' + href);
      const vpath = urlObj.searchParams.get('vpath');

      const iconContainer = $(el).find('.icon-container');
      let type = iconContainer.find('i').attr('title');
      if (!type) type = iconContainer.find('svg').attr('title');
      if (!type) type = iconContainer.find('i').attr('data-original-title');
      type = type || 'Unknown';

      if (vpath) {
        results.push({ title, type, vpath, link: href });
      }
    }
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
  };
}


/**
 * Handle beck:get_document tool call
 */
async function handleGetDocument(
  args: Record<string, unknown>,
  browser: BeckBrowser,
  converter: BeckConverter
): Promise<ToolResult> {
  let { vpath, format } = args as { vpath: string; format?: string };

  // Handle full URLs instead of vpath
  if (vpath.startsWith('http')) {
    const resolvedUrl = await browser.resolveUrl(vpath);
    const urlObj = new URL(resolvedUrl);
    vpath = urlObj.searchParams.get('vpath') || vpath;
  }

  const printUrl = `https://beck-online.beck.de/Print/CurrentDoc?vpath=${encodeURIComponent(vpath)}&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`;
  const html = await browser.fetchPage(printUrl);

  if (converter.isAccessDenied(html)) {
    return {
      content: [{ type: 'text', text: `ERROR: Access Denied for vpath: ${vpath}` }],
      isError: true,
    };
  }

  if (format === 'html') {
    return { content: [{ type: 'text', text: html }] };
  }

  const { title, body } = converter.htmlToMarkdown(html);
  if (!body.trim()) {
    return {
      content: [{ type: 'text', text: `ERROR: Document content empty or access denied (vpath: ${vpath}).` }],
      isError: true,
    };
  }
  return { content: [{ type: 'text', text: `# ${title}\n\n${body}` }] };
}

/**
 * Handle beck:get_legislation tool call
 */
async function handleGetLegislation(
  args: Record<string, unknown>,
  browser: BeckBrowser,
  converter: BeckConverter
): Promise<ToolResult> {
  const { law_abbreviation, paragraph } = args as { law_abbreviation: string; paragraph?: string };
  const bcidUrl = `https://beck-online.beck.de/Bcid?typ=reference&y=100&g=${encodeURIComponent(law_abbreviation)}&p=${encodeURIComponent(paragraph || '')}`;

  const finalUrl = await browser.resolveUrl(bcidUrl);
  const vpath = new URL(finalUrl).searchParams.get('vpath');

  if (!vpath) {
    return { content: [{ type: 'text', text: 'Could not resolve legislation.' }], isError: true };
  }

  const printUrl = `https://beck-online.beck.de/Print/CurrentDoc?vpath=${encodeURIComponent(vpath)}&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`;
  const html = await browser.fetchPage(printUrl);

  if (converter.isAccessDenied(html)) {
    return {
      content: [{ type: 'text', text: `ERROR: Access Denied for ${law_abbreviation} ${paragraph}` }],
      isError: true,
    };
  }

  const { title, body } = converter.htmlToMarkdown(html);
  if (!body.trim()) {
    return {
      content: [{ type: 'text', text: `ERROR: Empty content for ${law_abbreviation} ${paragraph}.` }],
      isError: true,
    };
  }
  return { content: [{ type: 'text', text: `# ${title}\n\n${body}` }] };
}


/**
 * Handle beck:resolve_citation tool call
 */
async function handleResolveCitation(
  args: Record<string, unknown>,
  browser: BeckBrowser
): Promise<ToolResult> {
  const { citation } = args as { citation: string };
  const searchUrl = `https://beck-online.beck.de/Search?words=${encodeURIComponent(citation)}`;
  const finalUrl = await browser.resolveUrl(searchUrl);

  if (finalUrl.includes('/Dokument?')) {
    const urlObj = new URL(finalUrl);
    const vpath = urlObj.searchParams.get('vpath');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              citation,
              vpath,
              canonical_url: finalUrl,
            },
            null,
            2
          ),
        },
      ],
    };
  } else {
    return {
      content: [
        {
          type: 'text',
          text: `Could not resolve citation "${citation}" to a single document. It might lead to a hitlist or be invalid.`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle beck:get_context tool call
 */
async function handleGetContext(
  args: Record<string, unknown>,
  browser: BeckBrowser,
  converter: BeckConverter
): Promise<ToolResult> {
  const { vpath } = args as { vpath: string };
  const url = `https://beck-online.beck.de/Dokument?vpath=${encodeURIComponent(vpath)}`;
  const html = await browser.fetchPage(url);
  const context = converter.extractContext(html);
  return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
}

/**
 * Handle beck:get_suggestions tool call
 */
async function handleGetSuggestions(
  args: Record<string, unknown>,
  browser: BeckBrowser
): Promise<ToolResult> {
  const { term } = args as { term: string };
  const url = `https://beck-online.beck.de/Suggest/?typ=std&term=${encodeURIComponent(term)}`;
  const jsonStr = await browser.fetchPage(url);
  const $ = cheerio.load(jsonStr);
  const rawJson = $('body').text();

  try {
    const data = JSON.parse(rawJson);
    const suggestions = data.values ? data.values.map((v: { label: string }) => v.label) : [];
    return { content: [{ type: 'text', text: JSON.stringify(suggestions, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: 'Failed to parse suggestions JSON.' }], isError: true };
  }
}

/**
 * Handle beck:get_referenced_documents tool call
 */
async function handleGetReferencedDocuments(
  args: Record<string, unknown>,
  browser: BeckBrowser
): Promise<ToolResult> {
  const { vpath } = args as { vpath: string };
  const printUrl = `https://beck-online.beck.de/Print/CurrentDoc?vpath=${encodeURIComponent(vpath)}&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`;
  const html = await browser.fetchPage(printUrl);
  const $ = cheerio.load(html);

  const refs: Array<{ text: string; vpath: string }> = [];
  $('a[href*="vpath="]').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (text && href) {
      const urlObj = new URL('https://beck.de' + href);
      const vpathRef = urlObj.searchParams.get('vpath');
      if (vpathRef) {
        refs.push({ text, vpath: vpathRef });
      }
    }
  });

  return { content: [{ type: 'text', text: JSON.stringify(refs, null, 2) }] };
}


/**
 * Main handler for Beck tool calls.
 * Routes tool calls to the appropriate handler function.
 *
 * @param toolName - Full tool name including 'beck:' prefix
 * @param args - Tool arguments
 * @param browser - BeckBrowser instance for page fetching
 * @param converter - BeckConverter instance for HTML conversion
 * @returns Promise resolving to ToolResult
 */
export async function handleBeckToolCall(
  toolName: string,
  args: Record<string, unknown>,
  browser: BeckBrowser,
  converter: BeckConverter
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'beck:search':
        return await handleSearch(args, browser);

      case 'beck:get_document':
        return await handleGetDocument(args, browser, converter);

      case 'beck:get_legislation':
        return await handleGetLegislation(args, browser, converter);

      case 'beck:resolve_citation':
        return await handleResolveCitation(args, browser);

      case 'beck:get_context':
        return await handleGetContext(args, browser, converter);

      case 'beck:get_suggestions':
        return await handleGetSuggestions(args, browser);

      case 'beck:get_referenced_documents':
        return await handleGetReferencedDocuments(args, browser);

      default:
        return {
          content: [{ type: 'text', text: `Unknown Beck tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
