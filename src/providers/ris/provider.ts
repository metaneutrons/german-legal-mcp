import { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { rootLogger } from '../../shared/logger.js';
import { validateConversion } from '../../shared/converter.js';
import { extractSection } from '../../shared/extract-section.js';
import { saveToFile } from '../../shared/save-to-file.js';
import { RisClient } from './client.js';
import { RisDataClient } from './data-client.js';
import { risHtmlToMarkdown } from './converter.js';
import { parseToc } from './toc.js';
import { DiskTocCache, type RisTocCache } from './toc-cache.js';
import { risTools } from './tools/index.js';
import type { RisApplication, RisSort } from './types.js';
import { normalizeToolName } from '../../shared/tool-names.js';
import { assertRisDocumentUrl, buildRisDocumentUrl } from './network-policy.js';

const logger = rootLogger.child({ module: 'ris-provider' });

export class RisProvider implements Provider {
  readonly name = 'ris';
  private readonly client: RisDataClient;

  constructor(
    client: RisDataClient | RisClient = new RisDataClient(),
    private readonly tocCache: RisTocCache = new DiskTocCache(),
  ) {
    this.client = client instanceof RisDataClient
      ? client
      : new RisDataClient(client);
  }

  getTools(): ToolDefinition[] {
    return risTools;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const canonicalName = normalizeToolName(toolName);
    if (canonicalName === 'ris_search') return this.handleSearch(args);
    if (canonicalName === 'ris_get') return this.handleGet(args);
    if (canonicalName === 'ris_get_norm') return this.handleGetNorm(args);
    if (canonicalName === 'ris_toc') return this.handleGetToc(args);
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }

  async shutdown(): Promise<void> {
    logger.info('RIS provider shutdown');
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const {
      query,
      application = 'bundesrecht',
      court,
      bundesland,
      sort,
      limit = 10,
    } = args as {
      query: string;
      application?: RisApplication;
      court?: string;
      bundesland?: string;
      sort?: RisSort;
      limit?: number;
    };

    logger.info('Searching', { application, queryLength: query.length, sort, bundesland });
    const result = await this.client.searchRis(application, { query, court, bundesland, sort, limit });

    if (result.hits.length === 0) {
      return { content: [{ type: 'text', text: `No RIS results for "${query}" in ${application}.` }] };
    }

    const markdown = result.hits
      .map((h, i) => {
        const meta = [h.organ, h.bundesland, h.date, h.ecli].filter(Boolean).join(' · ');
        const lines = [`${i + 1}. **${h.title}**`, `   - id: \`${h.id}\` (applikation: \`${h.applikation}\`)`];
        if (meta) lines.push(`   - ${meta}`);
        if (h.contentUrl) lines.push(`   - url: ${h.contentUrl}`);
        // A Rechtssatz links to full decisions — point at the newest so the
        // caller can fetch it with ris_get id=<…> applikation=Justiz.
        const newest = h.decisionTexts?.[0];
        if (newest) {
          lines.push(
            `   - full decision: \`${newest.id}\`${newest.date ? ` (${newest.date})` : ''} → ris_get id=<…> applikation=${h.applikation}`,
          );
        }
        return lines.join('\n');
      })
      .join('\n\n');

    return {
      content: [
        { type: 'text', text: `Found ${result.total} results (showing ${result.hits.length}):\n\n${markdown}` },
      ],
    };
  }

  private async handleGet(args: Record<string, unknown>): Promise<ToolResult> {
    const { content_url, id, applikation, section, save_path } = args as {
      content_url?: string;
      id?: string;
      applikation?: string;
      section?: string;
      save_path?: string;
    };

    const url = content_url
      ? assertRisDocumentUrl(content_url)
      : id && applikation
        ? buildRisDocumentUrl(applikation, id)
        : undefined;
    if (!url) {
      return {
        content: [{ type: 'text', text: 'ris_get requires `content_url`, or `id` + `applikation`.' }],
        isError: true,
      };
    }

    logger.info('Fetching document', { url, section });
    const html = await this.client.fetchHtml(url);
    const markdown = risHtmlToMarkdown(html);
    validateConversion(markdown, 'RIS (Austria)');

    // Surgical, token-preserving retrieval: a single Randnummer ("Rn 5"), an Rn
    // range ("Rn 5-9"), a line range ("lines:1-40"), or a heading ("Spruch").
    // section and save_path compose: extract first, then save what was extracted.
    const content = section ? extractSection(markdown, section) : markdown;

    if (save_path) {
      return saveToFile(save_path, content, `Source: ${url}${section ? ` (section: ${section})` : ''}`);
    }
    return { content: [{ type: 'text', text: content }] };
  }

  private async handleGetNorm(args: Record<string, unknown>): Promise<ToolResult> {
    const {
      law,
      paragraph,
      application = 'bundesrecht',
      bundesland,
      save_path,
    } = args as {
      law: string;
      paragraph: string;
      application?: 'bundesrecht' | 'landesrecht';
      bundesland?: string;
      save_path?: string;
    };

    logger.info('Fetching norm', { law, paragraph, application, bundesland });
    const result = await this.client.getNorm(application, { law, paragraph, bundesland });

    const hit = result.hits[0];
    if (!hit?.contentUrl) {
      const where = bundesland ? ` (${bundesland})` : '';
      return {
        content: [{ type: 'text', text: `No RIS norm found for ${law} § ${paragraph}${where}.` }],
        isError: true,
      };
    }

    const html = await this.client.fetchHtml(assertRisDocumentUrl(hit.contentUrl));
    const markdown = risHtmlToMarkdown(html);
    validateConversion(markdown, 'RIS (Austria)');

    const note = result.total > 1 ? `\n\n_(${result.total} matching documents — showing the first)_` : '';
    const body = markdown + note;

    if (save_path) return saveToFile(save_path, body, `${law} § ${paragraph}`);
    return { content: [{ type: 'text', text: body }] };
  }

  private async handleGetToc(args: Record<string, unknown>): Promise<ToolResult> {
    const { law, application = 'bundesrecht', bundesland, save_path } = args as {
      law: string;
      application?: 'bundesrecht' | 'landesrecht';
      bundesland?: string;
      save_path?: string;
    };

    logger.info('Fetching table of contents', { law, application, bundesland });
    const source = await this.client.resolveWholeLawUrl(application, { law, bundesland });
    if (!source) {
      const hint = application === 'landesrecht' ? ' and set `bundesland`' : '';
      return {
        content: [
          {
            type: 'text',
            text: `Could not resolve law "${law}". Try the full title (e.g. "Urheberrechtsgesetz" rather than "UrhG")${hint}.`,
          },
        ],
        isError: true,
      };
    }

    // The whole-law doc is large and slow to generate server-side (the ABGB
    // takes ~20s). A law's structure is stable, so cache the parsed TOC and pay
    // that cost at most once per law per TTL; a warm hit returns in <50ms.
    const cached = await this.tocCache.get(source.url);
    let entries: ReturnType<typeof parseToc>;
    if (cached) {
      logger.info('Table of contents served from cache', { law, entries: cached.entries.length });
      entries = cached.entries;
    } else {
      const html = await this.client.fetchHtml(assertRisDocumentUrl(source.url), 90_000);
      entries = parseToc(html);
      if (entries.length > 0) {
        // A cache-write failure must not fail an otherwise-successful fetch.
        await this.tocCache
          .put({ url: source.url, title: source.title, entries, fetchedAt: Date.now() })
          .catch((err) => logger.warn('Failed to cache table of contents', { url: source.url, err }));
      }
    }
    if (entries.length === 0) {
      return { content: [{ type: 'text', text: `No table of contents found for ${source.title}.` }], isError: true };
    }

    const lines = entries.map((e) => `- § ${e.paragraph}${e.heading ? ` — ${e.heading}` : ''}`);
    const body =
      `# ${source.title} — Inhaltsverzeichnis (${entries.length} §§)\n\n` +
      `${lines.join('\n')}\n\n` +
      `_Read a paragraph with ris_get_norm law="${law}" paragraph="<§>"._`;

    if (save_path) return saveToFile(save_path, body, `${source.title} — Inhaltsverzeichnis`);
    return { content: [{ type: 'text', text: body }] };
  }
}
