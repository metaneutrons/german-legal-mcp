import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type {
  Provider,
  ToolDefinition,
} from './shared/types.js';
import type { ProviderComponentReference } from './contracts/provider-component.js';
import { ProviderRegistry, type ProviderLoadFailure } from './provider-registry.js';
import { ConfigurationError } from './config.js';

function fixtureProvider(name: string, toolName = `${name}_search`): Provider {
  return {
    name,
    getTools: (): ToolDefinition[] => [{
      name: toolName,
      description: 'Fixture search',
      inputSchema: z.object({}),
    }],
    handleToolCall: vi.fn(async () => ({
      content: [{ type: 'text', text: name }],
    })),
    shutdown: vi.fn(async () => undefined),
  };
}

function manifestEntry(name: string, provider: Provider | null): ProviderComponentReference {
  return {
    id: name,
    distribution: 'public',
    load: async () => ({
      component: {
        metadata: {
          id: name,
          description: name,
          distribution: 'public',
          access: 'public',
          resourceTypes: ['case-law'],
          enablementVariables: [],
          runtime: {
            browser: false,
            cache: false,
            daemon: false,
            search: true,
            documents: false,
            tableOfContents: false,
            authentication: false,
            status: false,
            enumeration: false,
          },
        },
        createMcpProvider: () => provider,
        createDataClient: () => ({
          search: vi.fn(async () => ({ results: [], failures: [] })),
          get: vi.fn(async () => { throw new Error('not implemented'); }),
        }),
      },
    }),
  };
}

describe('ProviderRegistry', () => {
  it('uses the manifest for loading, tools, dispatch and shutdown', async () => {
    const provider = fixtureProvider('fixture');
    const registry = new ProviderRegistry([
      manifestEntry('fixture', provider),
      manifestEntry('disabled', null),
    ]);

    await registry.load();

    expect(registry.getProviders()).toEqual([provider]);
    expect(registry.getTools().map((tool) => tool.name)).toEqual(['fixture_search']);
    await expect(registry.handleToolCall('fixture_search', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'fixture' }],
    });
    await registry.shutdown();
    expect(provider.shutdown).toHaveBeenCalledOnce();
  });

  it('rejects a manifest/factory name mismatch', async () => {
    const failures: string[] = [];
    const registry = new ProviderRegistry([
      manifestEntry('expected', fixtureProvider('unexpected')),
    ]);

    await registry.load(({ provider }) => failures.push(provider));

    expect(failures).toEqual(['expected']);
    expect(registry.getProviders()).toEqual([]);
  });

  it('disables a misconfigured provider without aborting the others', async () => {
    const good = fixtureProvider('good');
    const badEntry: ProviderComponentReference = {
      ...manifestEntry('bad', null),
      load: async () => ({
        component: {
          metadata: {
            id: 'bad',
            description: 'bad',
            distribution: 'public',
            access: 'public',
            resourceTypes: ['case-law'],
            enablementVariables: [],
            runtime: {
              browser: false,
              cache: false,
              daemon: false,
              search: true,
              documents: false,
              tableOfContents: false,
              authentication: false,
              status: false,
              enumeration: false,
            },
          },
          createMcpProvider: () => {
            throw new ConfigurationError(['GLMCP_BAD_URL must be a valid absolute URL']);
          },
          createDataClient: () => ({
            search: vi.fn(async () => ({ results: [], failures: [] })),
            get: vi.fn(async () => { throw new Error('not implemented'); }),
          }),
        },
      }),
    };
    const failures: Array<{ provider: string; error: unknown }> = [];
    const registry = new ProviderRegistry([badEntry, manifestEntry('good', good)]);

    // Must NOT throw — a single bad provider used to abort the whole load.
    await registry.load((f) => failures.push(f));

    expect(failures.map((f) => f.provider)).toEqual(['bad']);
    expect(failures[0]?.error).toBeInstanceOf(ConfigurationError);
    expect(registry.getProviders()).toEqual([good]);
    expect(registry.getTools().map((t) => t.name)).toEqual(['good_search']);
  });

  it('removes a provider that fails to initialize', async () => {
    const flaky = fixtureProvider('flaky');
    flaky.initialize = vi.fn(async () => {
      throw new Error('init boom');
    });
    const failures: string[] = [];
    const registry = new ProviderRegistry([manifestEntry('flaky', flaky)]);

    await registry.load(({ provider }) => failures.push(provider));

    expect(failures).toEqual(['flaky']);
    expect(registry.getProviders()).toEqual([]);
    expect(flaky.shutdown).toHaveBeenCalledOnce();
  });

  it('validates, defaults and strips arguments before provider dispatch', async () => {
    const provider = fixtureProvider('fixture');
    provider.getTools = () => [{
      name: 'fixture_search',
      description: 'Fixture search',
      inputSchema: z.object({
        query: z.string().min(3),
        limit: z.number().int().max(10).default(5),
      }),
    }];
    const registry = new ProviderRegistry([manifestEntry('fixture', provider)]);
    await registry.load();

    await expect(registry.handleToolCall('fixture_search', {
      query: 'valid',
      ignored: 'removed',
    })).resolves.toEqual({ content: [{ type: 'text', text: 'fixture' }] });
    expect(provider.handleToolCall).toHaveBeenCalledWith('fixture_search', {
      query: 'valid',
      limit: 5,
    });

    await expect(registry.handleToolCall('fixture_search', {
      query: 'x',
      limit: 99,
    })).resolves.toMatchObject({ isError: true });
    expect(provider.handleToolCall).toHaveBeenCalledTimes(1);
  });

  it('returns a stable unknown-tool result', async () => {
    const registry = new ProviderRegistry([]);
    await expect(registry.handleToolCall('invalid', {})).resolves.toMatchObject({
      isError: true,
    });
  });

  it('accepts legacy colon aliases without advertising them', async () => {
    const provider = fixtureProvider('fixture');
    const registry = new ProviderRegistry([manifestEntry('fixture', provider)]);
    await registry.load();

    await expect(registry.handleToolCall('fixture:search', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'fixture' }],
    });
    expect(provider.handleToolCall).toHaveBeenCalledWith('fixture_search', {});
    expect(registry.getTools().map(({ name }) => name)).toEqual(['fixture_search']);
  });

  it('propagates an explicit request context without changing context-free dispatch', async () => {
    const provider = fixtureProvider('fixture');
    const registry = new ProviderRegistry([manifestEntry('fixture', provider)]);
    const signal = new globalThis.AbortController().signal;
    await registry.load();

    await registry.handleToolCall('fixture_search', {}, { signal });

    expect(provider.handleToolCall).toHaveBeenCalledWith(
      'fixture_search',
      {},
      { signal },
    );
  });

  it('disables a provider that declares a non-canonical tool name', async () => {
    const failures: Array<{ provider: string; error: unknown }> = [];
    const registry = new ProviderRegistry([
      manifestEntry('fixture', fixtureProvider('fixture', 'fixture:search')),
    ]);

    await registry.load((failure) => failures.push(failure));

    expect(registry.getProviders()).toEqual([]);
    expect(registry.getTools()).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(String(failures[0]?.error)).toContain('unsupported tool name');
  });

  it('rejects a second load without corrupting the loaded registry', async () => {
    const provider = fixtureProvider('fixture');
    const registry = new ProviderRegistry([manifestEntry('fixture', provider)]);
    await registry.load();

    await expect(registry.load()).rejects.toThrow('may only be called once');
    expect(registry.getProviders()).toEqual([provider]);
    expect(registry.getTools().map(({ name }) => name)).toEqual(['fixture_search']);
    await expect(registry.handleToolCall('fixture_search', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'fixture' }],
    });
  });

  it('reports a duplicate manifest id without removing the first provider', async () => {
    const first = fixtureProvider('fixture');
    const duplicate = fixtureProvider('fixture');
    const failures: ProviderLoadFailure[] = [];
    const registry = new ProviderRegistry([
      manifestEntry('fixture', first),
      manifestEntry('fixture', duplicate),
    ]);

    await registry.load((failure) => failures.push(failure));

    expect(failures).toHaveLength(1);
    expect(String(failures[0]?.error)).toContain('Duplicate provider manifest id');
    expect(registry.getProviders()).toEqual([first]);
    expect(registry.getTools().map(({ name }) => name)).toEqual(['fixture_search']);
  });
});
