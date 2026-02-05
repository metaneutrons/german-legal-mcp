"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const beck_browser_js_1 = require("./beck_browser.js");
const converter_js_1 = require("./converter.js");
const cheerio = __importStar(require("cheerio"));
const browser = beck_browser_js_1.BeckBrowser.getInstance();
const converter = new converter_js_1.BeckConverter();
const server = new index_js_1.Server({
    name: "beck-online-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "search",
                description: "Search the Beck Online legal database for laws, cases, and commentaries.",
                inputSchema: zod_1.z.object({
                    query: zod_1.z.string().describe("Search terms (e.g., 'Urheberrecht', 'BGB § 123')"),
                    page: zod_1.z.number().optional().default(1).describe("Page number"),
                    category: zod_1.z.enum(["Gesetz", "Rechtsprechung", "Kommentar", "Aufsatz"]).optional().describe("Filter by document type"),
                }),
            },
            {
                name: "get_document",
                description: "Retrieve the full content of a document.",
                inputSchema: zod_1.z.object({
                    vpath: zod_1.z.string().describe("Unique document identifier path (e.g. bibdata/ges/...)"),
                    format: zod_1.z.enum(["markdown", "html"]).optional().default("markdown").describe("Output format"),
                }),
            },
            {
                name: "get_legislation",
                description: "Directly retrieve a specific law/norm (e.g. BGB 823).",
                inputSchema: zod_1.z.object({
                    law_abbreviation: zod_1.z.string().describe("Law abbreviation (e.g. 'BGB', 'UrhG')"),
                    paragraph: zod_1.z.string().optional().describe("Paragraph number (e.g. '15')"),
                }),
            },
            {
                name: "get_context",
                description: "Get breadcrumbs and navigation links for a document.",
                inputSchema: zod_1.z.object({
                    vpath: zod_1.z.string().describe("Unique document identifier path"),
                }),
            },
            {
                name: "get_suggestions",
                description: "Get autocomplete suggestions for a legal term.",
                inputSchema: zod_1.z.object({
                    term: zod_1.z.string().describe("Partial term to complete"),
                }),
            },
            {
                name: "get_referenced_documents",
                description: "Get list of documents cited in the given document.",
                inputSchema: zod_1.z.object({
                    vpath: zod_1.z.string().describe("Unique document identifier path"),
                }),
            }
        ],
    };
});
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === "search") {
            const { query, page, category } = args;
            let url = `https://beck-online.beck.de/Search?pagenr=${page}&words=${encodeURIComponent(query)}`;
            const html = await browser.fetchPage(url);
            const currentUrl = browser.getCurrentUrl();
            // Check if redirected directly to a document
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
            const results = [];
            $('.treffer-wrapper').each((i, el) => {
                const titleEl = $(el).find('.treffer-firstline-text a');
                const title = titleEl.text().trim();
                const href = titleEl.attr('href');
                if (title && href) {
                    const urlObj = new URL('https://beck-online.beck.de' + href);
                    const vpath = urlObj.searchParams.get('vpath');
                    // Extract type from icon title or class if available
                    const type = $(el).find('.icon-container i').attr('title') || "Unknown";
                    if (vpath) {
                        results.push({
                            title,
                            type,
                            vpath,
                            link: href
                        });
                    }
                }
            });
            return {
                content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
            };
        }
        if (name === "get_document") {
            const { vpath, format } = args;
            const printUrl = `https://beck-online.beck.de/Print/CurrentDoc?vpath=${encodeURIComponent(vpath)}&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`;
            const html = await browser.fetchPage(printUrl);
            if (format === "html") {
                return { content: [{ type: "text", text: html }] };
            }
            const markdown = converter.htmlToMarkdown(html);
            return { content: [{ type: "text", text: markdown }] };
        }
        if (name === "get_legislation") {
            const { law_abbreviation, paragraph } = args;
            // Construct Bcid URL to trigger redirect
            const bcidUrl = `https://beck-online.beck.de/Bcid?typ=reference&y=100&g=${encodeURIComponent(law_abbreviation)}&p=${encodeURIComponent(paragraph || '')}`;
            await browser.fetchPage(bcidUrl);
            const currentUrl = browser.getCurrentUrl();
            const vpath = new URL(currentUrl).searchParams.get('vpath');
            if (!vpath) {
                return { content: [{ type: "text", text: "Could not resolve legislation to a document." }], isError: true };
            }
            // Fetch print view
            const printUrl = `https://beck-online.beck.de/Print/CurrentDoc?vpath=${encodeURIComponent(vpath)}&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`;
            const html = await browser.fetchPage(printUrl);
            const markdown = converter.htmlToMarkdown(html);
            return { content: [{ type: "text", text: markdown }] };
        }
        if (name === "get_suggestions") {
            const { term } = args;
            const url = `https://beck-online.beck.de/Suggest/?typ=std&term=${encodeURIComponent(term)}`;
            const jsonStr = await browser.fetchPage(url);
            // The fetchPage returns body content (HTML usually). For JSON endpoint, it returns JSON string inside body.
            // Puppeteer page.content() wraps it in <html><head></head><body><pre>...</pre></body></html> usually.
            // We need to extract the text.
            const $ = cheerio.load(jsonStr);
            const rawJson = $('body').text();
            try {
                const data = JSON.parse(rawJson);
                // The response structure from analysis: { values: [ { label: "..." }, ... ] }
                const suggestions = data.values ? data.values.map((v) => v.label) : [];
                return { content: [{ type: "text", text: JSON.stringify(suggestions, null, 2) }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: "Failed to parse suggestions JSON." }], isError: true };
            }
        }
        if (name === "get_context") {
            const { vpath } = args;
            // Fetch the regular document page (not print) to get breadcrumbs and nav
            const url = `https://beck-online.beck.de/Dokument?vpath=${encodeURIComponent(vpath)}`;
            const html = await browser.fetchPage(url);
            const context = converter.extractContext(html);
            return { content: [{ type: "text", text: JSON.stringify(context, null, 2) }] };
        }
        if (name === "get_referenced_documents") {
            const { vpath } = args;
            const printUrl = `https://beck-online.beck.de/Print/CurrentDoc?vpath=${encodeURIComponent(vpath)}&printdialogmode=CurrentDoc&options=WithFootNoteInText&options=WithLinks`;
            const html = await browser.fetchPage(printUrl);
            const $ = cheerio.load(html);
            const refs = [];
            $('a[href*="vpath="]').each((i, el) => {
                const text = $(el).text().trim();
                const href = $(el).attr('href');
                if (text && href) {
                    const vpathRef = new URL('https://beck.de' + href).searchParams.get('vpath');
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
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
const transport = new stdio_js_1.StdioServerTransport();
await server.connect(transport);
