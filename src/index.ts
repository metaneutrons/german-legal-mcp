import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BeckBrowser } from "./beck_browser.js";
import { BeckConverter } from "./converter.js";
import * as cheerio from 'cheerio';

const browser = BeckBrowser.getInstance();
const converter = new BeckConverter();

const server = new Server(
  {
    name: "beck-online-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Check if Beck Online credentials are configured
const isBeckConfigured = () => {
  return !!(process.env.BECK_USERNAME && process.env.BECK_PASSWORD);
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Don't expose Beck tools if credentials aren't configured
  if (!isBeckConfigured()) {
    return { tools: [] };
  }

  return {
    tools: [
      {
        name: "beck:search",
        description: "Search the Beck Online legal database for laws, cases, and commentaries.",
        inputSchema: z.object({
          query: z.string().describe("Search terms (e.g., 'Urheberrecht', 'BGB § 123')"),
          page: z.number().optional().default(1).describe("Page number"),
          only_available: z.boolean().optional().default(false).describe("Only include results from your active modules/subscriptions"),
          category: z.enum(["Gesetz", "Rechtsprechung", "Kommentar", "Aufsatz", "Handbuch", "Formular"]).optional().describe("Filter by document type"),
        }),
      },
      {
        name: "beck:get_document",
        description: "Retrieve the full content of a document from Beck Online.",
        inputSchema: z.object({
          vpath: z.string().describe("Unique document identifier path (e.g. bibdata/ges/...) or a full Beck Online URL"),
          format: z.enum(["markdown", "html"]).optional().default("markdown").describe("Output format"),
        }),
      },
      {
        name: "beck:get_legislation",
        description: "Directly retrieve a specific law/norm from Beck Online (e.g. BGB 823).",
        inputSchema: z.object({
          law_abbreviation: z.string().describe("Law abbreviation (e.g. 'BGB', 'UrhG')"),
          paragraph: z.string().optional().describe("Paragraph number (e.g. '15')"),
        }),
      },
      {
        name: "beck:resolve_citation",
        description: "Transform a natural language citation into a canonical Beck Online vpath and title.",
        inputSchema: z.object({
          citation: z.string().describe("The citation string (e.g. 'NJW 2024, 123', '§ 15 UrhG')"),
        }),
      },
      {
        name: "beck:get_context",
        description: "Get breadcrumbs and navigation links for a Beck Online document.",
        inputSchema: z.object({
          vpath: z.string().describe("Unique document identifier path"),
        }),
      },
      {
        name: "beck:get_suggestions",
        description: "Get autocomplete suggestions for a legal term from Beck Online.",
        inputSchema: z.object({
          term: z.string().describe("Partial term to complete"),
        }),
      },
      {
        name: "beck:get_referenced_documents",
        description: "Get list of documents cited in the given Beck Online document.",
        inputSchema: z.object({
            vpath: z.string().describe("Unique document identifier path"),
        }),
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Reject beck:* tool calls if credentials aren't configured
  if (name.startsWith("beck:") && !isBeckConfigured()) {
    return {
      content: [{ type: "text", text: "Beck Online tools are disabled. Set BECK_USERNAME and BECK_PASSWORD environment variables to enable." }],
      isError: true,
    };
  }

  try {
    if (name === "beck:search") {
      const { query, category, only_available } = args as any;
      const page = (args as any).page || 1;
      let url = `https://beck-online.beck.de/Search?pagenr=${page}&words=${encodeURIComponent(query)}`;
      
      const categoryMap: Record<string, string> = {
          "Gesetz": "spubtyp0:ges",
          "Rechtsprechung": "spubtyp0:ent",
          "Kommentar": "spubtyp0:komm",
          "Aufsatz": "spubtyp0:aufs",
          "Handbuch": "spubtyp0:hdb",
          "Formular": "spubtyp0:form"
      };

      if (category && categoryMap[category]) {
          url += `&Addfilter=${encodeURIComponent(categoryMap[category])}`;
      }

      if (only_available) {
          url += '&MEINBECKONLINE=True';
      }
      
      const html = await browser.fetchPage(url);
      const currentUrl = browser.getCurrentUrl();

      if (currentUrl.includes('/Dokument?')) {
          const vpath = new URL(currentUrl).searchParams.get('vpath');
          if (vpath) {
              return {
                  content: [{ 
                      type: "text", 
                      text: JSON.stringify([{
                          title: "Direct Hit (Redirected)",
                          type: "Unknown",
                          vpath: vpath,
                          link: currentUrl
                      }])
                  }]
              };
          }
      }

      const $ = cheerio.load(html);
      const results: any[] = [];

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
              type = type || "Unknown";

              if (vpath) {
                  results.push({ title, type, vpath, link: href });
              }
          }
      });

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    if (name === "beck:get_document") {
        let { vpath, format } = args as any;
        
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
                content: [{ type: "text", text: `ERROR: Access Denied for vpath: ${vpath}` }],
                isError: true
            };
        }

        if (format === "html") {
            return { content: [{ type: "text", text: html }] };
        }
        
        const { title, body } = converter.htmlToMarkdown(html);
        if (!body.trim()) {
             return {
                 content: [{ type: "text", text: `ERROR: Document content empty or access denied (vpath: ${vpath}).` }],
                 isError: true
             };
        }
        return { content: [{ type: "text", text: `# ${title}\n\n${body}` }] };
    }

    if (name === "beck:resolve_citation") {
        const { citation } = args as any;
        const searchUrl = `https://beck-online.beck.de/Search?words=${encodeURIComponent(citation)}`;
        const finalUrl = await browser.resolveUrl(searchUrl);
        
        if (finalUrl.includes('/Dokument?')) {
            const urlObj = new URL(finalUrl);
            const vpath = urlObj.searchParams.get('vpath');
            return {
                content: [{ 
                    type: "text", 
                    text: JSON.stringify({
                        citation,
                        vpath,
                        canonical_url: finalUrl
                    }, null, 2) 
                }]
            };
        } else {
            return {
                content: [{ type: "text", text: `Could not resolve citation "${citation}" to a single document. It might lead to a hitlist or be invalid.` }],
                isError: true
            };
        }
    }

    if (name === "beck:get_legislation") {
        const { law_abbreviation, paragraph } = args as any;
        const bcidUrl = `https://beck-online.beck.de/Bcid?typ=reference&y=100&g=${encodeURIComponent(law_abbreviation)}&p=${encodeURIComponent(paragraph || '')}`;
        
        const finalUrl = await browser.resolveUrl(bcidUrl);
        const vpath = new URL(finalUrl).searchParams.get('vpath');
        
        if (!vpath) {
            return { content: [{ type: "text", text: "Could not resolve legislation." }], isError: true };
        }

        const printUrl = `https://beck-online.beck.de/Print/CurrentDoc?vpath=${encodeURIComponent(vpath)}&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`;
        const html = await browser.fetchPage(printUrl);

        if (converter.isAccessDenied(html)) {
            return { content: [{ type: "text", text: `ERROR: Access Denied for ${law_abbreviation} ${paragraph}` }], isError: true };
        }

        const { title, body } = converter.htmlToMarkdown(html);
        if (!body.trim()) {
             return { content: [{ type: "text", text: `ERROR: Empty content for ${law_abbreviation} ${paragraph}.` }], isError: true };
        }
        return { content: [{ type: "text", text: `# ${title}\n\n${body}` }] };
    }

    if (name === "beck:get_suggestions") {
        const { term } = args as any;
        const url = `https://beck-online.beck.de/Suggest/?typ=std&term=${encodeURIComponent(term)}`;
        const jsonStr = await browser.fetchPage(url);
        const $ = cheerio.load(jsonStr);
        const rawJson = $('body').text();
        
        try {
            const data = JSON.parse(rawJson);
            const suggestions = data.values ? data.values.map((v: any) => v.label) : [];
            return { content: [{ type: "text", text: JSON.stringify(suggestions, null, 2) }] };
        } catch (e) {
             return { content: [{ type: "text", text: "Failed to parse suggestions JSON." }], isError: true };
        }
    }

    if (name === "beck:get_context") {
        const { vpath } = args as any;
        const url = `https://beck-online.beck.de/Dokument?vpath=${encodeURIComponent(vpath)}`;
        const html = await browser.fetchPage(url);
        const context = converter.extractContext(html);
        return { content: [{ type: "text", text: JSON.stringify(context, null, 2) }] };
    }

    if (name === "beck:get_referenced_documents") {
        const { vpath } = args as any;
        const printUrl = `https://beck-online.beck.de/Print/CurrentDoc?vpath=${encodeURIComponent(vpath)}&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`;
        const html = await browser.fetchPage(printUrl);
        const $ = cheerio.load(html);
        
        const refs: any[] = [];
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
        
        return { content: [{ type: "text", text: JSON.stringify(refs, null, 2) }] };
    }

    return {
      content: [{ type: "text", text: `Tool ${name} not implemented.` }],
      isError: true,
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();

async function cleanup() {
    console.error('[German-Legal MCP] Shutting down and cleaning up browser...');
    await browser.close();
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.stdin.on('close', async () => { await cleanup(); });

await server.connect(transport);
console.error('[German-Legal MCP] Server connected and ready.');
