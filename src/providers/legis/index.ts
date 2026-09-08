import type {
  Provider,
  ProviderFactory,
  ToolDefinition,
  ToolResult,
} from '../../shared/types.js';
import { defineProviderComponent } from '../../contracts/provider-component.js';
import { readBooleanEnv } from '../../config.js';
import { rootLogger } from '../../shared/logger.js';
import { saveToFile } from '../../shared/save-to-file.js';
import { validateConversion } from '../../shared/converter.js';
import { JPORTAL_STATES } from '../../shared/clients/jportal.js';
import { normalizeToolName } from '../../shared/tool-names.js';
import { legisTools } from './tools/index.js';
import { LegislationClient } from './client.js';
import type { LegisAdapter, TocEntry } from './types.js';
import { assertLegisDocumentId } from './network-policy.js';

const logger = rootLogger.child({ module: 'legis' });

export class LegisProvider implements Provider {
  readonly name = 'legis';
  private readonly client: LegislationClient;

  constructor(adapters?: readonly LegisAdapter[]) {
    this.client = new LegislationClient(adapters);
  }

  getTools(): ToolDefinition[] {
    return legisTools;
  }

  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const canonicalName = normalizeToolName(toolName);
    if (canonicalName === 'legis_search') return this.handleSearch(args);
    if (canonicalName === 'legis_get') return this.handleGet(args);
    if (canonicalName === 'legis_toc') return this.handleToc(args);
    if (canonicalName === 'legis_states') return this.handleStates();
    return {
      content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  async shutdown(): Promise<void> {
    this.client.shutdown();
    logger.info('Legis provider shutdown');
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const { query, state, limit = 10 } = args as {
      query: string;
      state: string;
      limit?: number;
    };
    const batch = await this.client.searchLegislation(query, {
      sources: [state],
      limit,
      limitPerSource: limit,
    });
    if (batch.failures.length > 0) throw batch.failures[0]?.error;
    const markdown = batch.results
      .map((result, index) => (
        `${index + 1}. **${result.title}**\n`
        + `   - ID: \`${result.id}\`\n`
        + `   - ${result.subtitle}${result.date ? ` (${result.date})` : ''}`
      ))
      .join('\n\n');

    return {
      content: [{
        type: 'text',
        text: `Found ${batch.results.length} results:\n\n${markdown}`,
      }],
    };
  }

  private async handleGet(args: Record<string, unknown>): Promise<ToolResult> {
    const { id, state, save_path } = args as {
      id: string;
      state: string;
      save_path?: string;
    };
    const entry = await this.client.getLegislation(state, assertLegisDocumentId(state, id));
    validateConversion(entry.content, `Landesrecht ${state}`);
    const markdown = `# ${entry.title}\n\n${entry.content}\n\n---\n**Source:** ${entry.url}`;

    if (save_path) {
      return saveToFile(
        save_path,
        markdown,
        `Title: ${entry.title}\nURL: ${entry.url}`,
      );
    }
    return { content: [{ type: 'text', text: markdown }] };
  }

  private async handleToc(args: Record<string, unknown>): Promise<ToolResult> {
    const { id, state, from, to, depth } = args as {
      id: string;
      state: string;
      from?: string;
      to?: string;
      depth?: number;
    };
    let entries = await this.client.getTableOfContents(state, assertLegisDocumentId(state, id));
    if (depth !== undefined) {
      entries = entries.filter((entry) => entry.depth <= depth);
    }
    entries = this.filterRange(entries, from, to);
    const lines = entries.map((entry) => {
      const indent = '  '.repeat(entry.depth);
      if (!entry.num) return `${indent}**${entry.title}**`;
      return entry.title
        ? `${indent}${entry.num} ${entry.title}`
        : `${indent}${entry.num}`;
    });
    return {
      content: [{
        type: 'text',
        text: `${entries.length} entries:\n\n${lines.join('\n')}`,
      }],
    };
  }

  private filterRange(
    entries: readonly TocEntry[],
    from?: string,
    to?: string,
  ): TocEntry[] {
    if (!from && !to) return [...entries];
    const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();
    const fromNormalized = from ? normalize(from) : undefined;
    const toNormalized = to ? normalize(to) : undefined;
    let inRange = fromNormalized === undefined;
    return entries.filter((entry) => {
      const number = normalize(entry.num);
      if (fromNormalized && number === fromNormalized) inRange = true;
      if (!inRange) return false;
      if (toNormalized && number === toNormalized) {
        inRange = false;
        return true;
      }
      return true;
    });
  }

  private handleStates(): ToolResult {
    const lines = [
      '| State | Status | Backend |',
      '|-------|--------|---------|',
      '| BUND | ✅ Available | gesetze-im-internet.de |',
      ...JPORTAL_STATES.map((state) => (
        `| ${state} | ✅ Available | jportal REST API |`
      )),
      '| NI | ✅ Available | voris.wolterskluwer-online.de |',
      '| BY | ✅ Available | gesetze-bayern.de |',
      '| BB | ✅ Available | bravors.brandenburg.de |',
      '| SN | ✅ Available | revosax.sachsen.de |',
      '| HB | ✅ Available | transparenz.bremen.de |',
      '| NW | ✅ Available | recht.nrw.de |',
    ];
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
}

export const createProvider: ProviderFactory = () => {
  if (!readBooleanEnv('GLMCP_LEGIS_ENABLED', true)) return null;
  return new LegisProvider();
};

export const component = defineProviderComponent({
  metadata: {
    id: 'legis',
    description: 'German federal and state legislation',
    distribution: 'public',
    access: 'public',
    resourceTypes: ['legislation'],
    enablementVariables: ['GLMCP_LEGIS_ENABLED'],
    runtime: {
      browser: false,
      cache: false,
      daemon: false,
      search: true,
      documents: true,
      tableOfContents: true,
      authentication: false,
      status: false,
      enumeration: true,
    },
  },
  createMcpProvider: createProvider,
  createDataClient: () => new LegislationClient(),
});

export * from './client.js';
export type * from './types.js';
