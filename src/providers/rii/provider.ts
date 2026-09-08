import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type { Provider, ToolDefinition, ToolResult } from '../../shared/types.js';
import { rootLogger } from '../../shared/logger.js';
import { validateConversion } from '../../shared/converter.js';
import { saveToFile } from '../../shared/save-to-file.js';
import { extractSection } from '../../shared/extract-section.js';
import { riiTools } from './tools/index.js';
import {
  formatHitCount,
  renderSearchTable,
  type SearchFormat,
} from '../../shared/search-format.js';
import { RiiConverter } from './converter.js';
import {
  createGermanDecisionAdapters,
  CaseLawClient,
} from './client.js';
import { clusterDecisions, describeClusters } from './cluster.js';
import type { DecisionAdapter, SourcedDecisionSearchResult } from './types.js';
import { normalizeToolName } from '../../shared/tool-names.js';
import { assertRiiDocumentId } from './network-policy.js';

const logger = rootLogger.child({ module: 'rii-provider' });

export class RiiProvider implements Provider {
  readonly name = 'rii';
  private readonly client: CaseLawClient;

  constructor(
    http: Pick<AxiosInstance, 'get' | 'post'> = axios,
    converter: RiiConverter = new RiiConverter(),
    adapters?: readonly DecisionAdapter[],
  ) {
    this.client = new CaseLawClient(
      adapters ?? createGermanDecisionAdapters(http, converter),
    );
  }

  getTools(): ToolDefinition[] {
    return riiTools;
  }

  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const canonicalName = normalizeToolName(toolName);
    const source = (args.source as string) || 'BUND';

    if (canonicalName === 'rii_search') {
      return this.handleSearch(source, args);
    }
    if (canonicalName === 'rii_get_decision') {
      if (source === 'ALL') {
        return {
          content: [{
            type: 'text',
            text: 'source "ALL" is only valid for rii_search; choose the source from a search result for rii_get_decision.',
          }],
          isError: true,
        };
      }
      return this.handleGet(source, args);
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  async shutdown(): Promise<void> {
    this.client.shutdown();
    logger.info('RII provider shutdown');
  }

  private async handleSearch(
    source: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const { query, limit = 10, page = 1, format, include_snippets, collapse_duplicates = true } = args as {
      query: string;
      limit?: number;
      page?: number;
      format?: SearchFormat;
      include_snippets?: boolean;
      collapse_duplicates?: boolean;
    };
    const batch = await this.client.searchDecisions(query, {
      sources: source === 'ALL' ? 'ALL' : [source],
      limit,
      limitPerSource: limit,
      page,
    });

    const clusters = collapse_duplicates ? clusterDecisions(batch.results) : [];
    const rows = collapse_duplicates
      ? clusters.map((cluster) => cluster.representative)
      : batch.results;

    const perSource = new Map<string, number>();
    for (const result of rows) {
      perSource.set(result.source, (perSource.get(result.source) ?? 0) + 1);
    }
    // Sum only the totals actually reported, so the figure is a floor rather
    // than a guess.
    const totals = batch.totals ?? {};
    const counted = Object.entries(totals);
    const totalKnown = counted.length > 0
      ? counted.reduce((sum, [, count]) => sum + count, 0)
      : undefined;

    // A portal can report a total yet win no row slots, since `limit` is shared
    // across portals. Those still belong in the breakdown: leaving them out
    // makes the headline total impossible to reconcile against the rows, and
    // "6.296 matches, none shown" is exactly the cue to re-query that portal
    // on its own.
    const contributing = new Set([...perSource.keys(), ...Object.keys(totals)]);
    const summary = [
      counted.length > 0
        ? `${formatHitCount(rows.length, totalKnown)} (totals reported by ${counted.length} of ${contributing.size} matching portals)`
        : formatHitCount(rows.length),
    ];
    if (source === 'ALL') {
      summary.push(
        `${contributing.size} of ${this.client.sources.length} portals: `
        + [...contributing]
          .map((id) => {
            const shown = perSource.get(id) ?? 0;
            const total = totals[id];
            return total === undefined ? `${id} ${shown}` : `${id} ${shown}/${total}`;
          })
          .join(' · '),
      );
    }
    if (batch.failures.length > 0) {
      summary.push(`${batch.failures.length} portal(s) unavailable: `
        + batch.failures.map((failure) => failure.source).join(', '));
    }
    if (page > 1) summary.push(`Page ${page}.`);
    // A source that cannot page says so, rather than quietly re-serving page 1.
    if (batch.unpaged?.length) {
      summary.push(`No page ${page} available from: ${batch.unpaged.join(', ')} `
        + '(these sources expose only their first page).');
    }
    // Named, never silent: a collapsed series is a choice the caller can undo
    // with collapse_duplicates: false.
    summary.push(...describeClusters(clusters));

    return {
      content: [{
        type: 'text',
        text: renderSearchTable({
          columns: [
            { header: 'src', value: (result) => result.source },
            { header: 'date', value: (result) => result.date },
            { header: 'court', value: (result) => result.court },
            { header: 'az', value: (result) => result.fileNumber },
            { header: 'ecli', value: (result) => result.ecli },
            { header: 'title', value: (result) => result.title, maxWidth: 120 },
            { header: 'docId', value: (result) => result.id },
            ...(include_snippets
              ? [{
                header: 'snippet',
                value: (result: SourcedDecisionSearchResult) => result.snippet,
                maxWidth: 200,
              }]
              : []),
          ],
          rows,
          summary,
          format: format ?? 'compact',
        }),
      }],
    };
  }

  private async handleGet(
    source: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const { doc_id, save_path } = args as {
      doc_id: string;
      save_path?: string;
    };
    const { part = 'L', section } = args as {
      part?: string;
      section?: string;
    };
    const decision = await this.client.getDecision(source, assertRiiDocumentId(source, doc_id), { part });
    validateConversion(decision.content, source);
    const markdown = [
      `# ${decision.title}`,
      `\n**Gericht:** ${decision.court}`,
      `**Datum:** ${decision.date}`,
      `**Aktenzeichen:** ${decision.fileNumber}`,
      decision.ecli ? `**ECLI:** ${decision.ecli}` : '',
    ].filter(Boolean).join('\n') + `\n\n---\n\n${decision.content}`;

    if (save_path) {
      return saveToFile(
        save_path,
        markdown,
        `Gericht: ${decision.court}\nDatum: ${decision.date}\nAktenzeichen: ${decision.fileNumber}`,
      );
    }
    if (section && source === 'BY') {
      return { content: [{ type: 'text', text: extractSection(markdown, section) }] };
    }
    return { content: [{ type: 'text', text: markdown }] };
  }

}
