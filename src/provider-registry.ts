import type {
  Provider,
  ToolCallContext,
  ToolDefinition,
  ToolResult,
} from './shared/types.js';
import {
  isCanonicalToolName,
  normalizeToolName,
} from './shared/tool-names.js';
import type {
  ProviderComponent,
  ProviderComponentReference,
} from './contracts/provider-component.js';
import { assertInputBudget, InputBudgetError } from './shared/input-budget.js';

export interface ProviderLoadFailure {
  readonly provider: string;
  readonly error: unknown;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();
  private readonly components = new Map<string, ProviderComponent>();
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly toolOwners = new Map<string, Provider>();
  private loaded = false;

  constructor(private readonly manifest: readonly ProviderComponentReference[]) {}

  getManifest(): readonly ProviderComponentReference[] {
    return this.manifest;
  }

  getComponents(): readonly ProviderComponent[] {
    return [...this.components.values()];
  }

  getProviders(): readonly Provider[] {
    return [...this.providers.values()];
  }

  getTools(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async load(onFailure?: (failure: ProviderLoadFailure) => void): Promise<void> {
    if (this.loaded) {
      throw new Error('ProviderRegistry.load() may only be called once');
    }
    this.loaded = true;
    const seenEntries = new Set<string>();

    for (const entry of this.manifest) {
      if (seenEntries.has(entry.id)) {
        onFailure?.({
          provider: entry.id,
          error: new Error(`Duplicate provider manifest id "${entry.id}"`),
        });
        continue;
      }
      seenEntries.add(entry.id);
      let candidate: Provider | null = null;
      try {
        const module = await entry.load();
        const { component } = module;
        if (component.metadata.id !== entry.id) {
          throw new Error(
            `Provider component id "${component.metadata.id}" does not match manifest id "${entry.id}"`,
          );
        }
        if (component.metadata.distribution !== entry.distribution) {
          throw new Error(
            `Provider component "${entry.id}" distribution "${component.metadata.distribution}" does not match manifest distribution "${entry.distribution}"`,
          );
        }
        this.components.set(entry.id, component);
        candidate = component.createMcpProvider();
        if (candidate === null) continue;
        if (candidate.name !== entry.id) {
          throw new Error(
            `Provider manifest id "${entry.id}" does not match factory name "${candidate.name}"`,
          );
        }
        const providerTools = candidate.getTools();
        const localNames = new Set<string>();
        for (const tool of providerTools) {
          if (!isCanonicalToolName(tool.name, candidate.name)) {
            throw new Error(
              `Provider "${candidate.name}" declares unsupported tool name "${tool.name}"; expected canonical provider_operation form`,
            );
          }
          if (localNames.has(tool.name) || this.tools.has(tool.name)) {
            throw new Error(`Duplicate tool name "${tool.name}"`);
          }
          localNames.add(tool.name);
        }
        await candidate.initialize?.();
        this.providers.set(candidate.name, candidate);
        for (const tool of providerTools) {
          this.tools.set(tool.name, tool);
          this.toolOwners.set(tool.name, candidate);
        }
      } catch (error) {
        // A provider that fails to load, has invalid configuration, or fails to
        // initialize disables ONLY itself — it must never abort the whole server.
        // A single misconfigured optional provider (e.g. a bad login URL)
        // would otherwise take all the other providers down with it. onFailure
        // surfaces the reason to the caller.
        this.providers.delete(entry.id);
        this.components.delete(entry.id);
        if (candidate !== null) {
          // A factory may allocate a browser, socket or cache before initialize()
          // completes. Since the candidate has not been registered yet, the
          // normal registry shutdown cannot see it; release it here exactly once.
          try {
            await candidate.shutdown();
          } catch {
            // Preserve the original load failure. Cleanup is best-effort and a
            // second error must not hide the reason the provider was disabled.
          }
        }
        onFailure?.({ provider: entry.id, error });
      }
    }
  }

  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolCallContext,
  ): Promise<ToolResult> {
    const canonicalName = normalizeToolName(toolName);
    const provider = this.toolOwners.get(canonicalName);
    const tool = this.tools.get(canonicalName);
    if (provider === undefined || tool === undefined) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    try {
      assertInputBudget(args);
    } catch (error) {
      if (!(error instanceof InputBudgetError)) throw error;
      return {
        content: [{
          type: 'text',
          text: `Invalid arguments for ${canonicalName}:\n- <root>: ${error.message}`,
        }],
        isError: true,
      };
    }

    // Tool schemas are executable boundary contracts, not documentation only.
    // Parse centrally so MCP, CLI and direct registry callers receive identical
    // required/default/bounds/refinement behavior and providers never see raw
    // untrusted arguments.
    const parsed = await tool.inputSchema.safeParseAsync(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `- ${path}: ${issue.message}`;
      });
      return {
        content: [{
          type: 'text',
          text: `Invalid arguments for ${canonicalName}:\n${issues.join('\n')}`,
        }],
        isError: true,
      };
    }
    if (typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) {
      return {
        content: [{
          type: 'text',
          text: `Invalid tool schema for ${canonicalName}: expected an object result`,
        }],
        isError: true,
      };
    }
    const validatedArgs = parsed.data as Record<string, unknown>;
    // Preserve the established two-argument provider contract for callers that
    // do not have an MCP request context. Besides keeping mocks and third-party
    // providers compatible, this avoids turning an absent optional value into
    // an observable third argument. When a context exists, propagate it so
    // cancellation and request-scoped admission controls remain effective.
    return context === undefined
      ? provider.handleToolCall(canonicalName, validatedArgs)
      : provider.handleToolCall(canonicalName, validatedArgs, context);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      this.getProviders().map((provider) => provider.shutdown()),
    );
    this.providers.clear();
    this.components.clear();
    this.tools.clear();
    this.toolOwners.clear();
  }
}
