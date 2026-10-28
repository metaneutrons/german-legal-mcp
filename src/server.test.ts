import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderComponentReference } from './contracts/provider-component.js';
import { createServerRuntime } from './server.js';
import type { Provider, ToolResult } from './shared/types.js';
import { UpdateChecker } from './update-check.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('MCP server tool-call admission', () => {
  it('bounds public callTool concurrency/queueing and makes shutdown idempotent', async () => {
    const releases = new Map<string, ReturnType<typeof deferred<ToolResult>>>();
    const started: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const shutdown = vi.fn(async () => {});
    const provider: Provider = {
      name: 'gate',
      getTools: () => [{
        name: 'gate_work',
        description: 'Hold one deterministic test operation.',
        inputSchema: z.object({ id: z.string() }).strict(),
      }],
      handleToolCall: async (_name, args, context) => {
        expect(context?.signal).toBeInstanceOf(globalThis.AbortSignal);
        const id = String(args.id);
        const release = deferred<ToolResult>();
        releases.set(id, release);
        started.push(id);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        try {
          return await release.promise;
        } finally {
          active -= 1;
        }
      },
      shutdown,
    };
    const manifest: ProviderComponentReference[] = [{
      id: 'gate',
      distribution: 'public',
      load: async () => ({
        component: {
          metadata: {
            id: 'gate',
            description: 'Admission-test provider',
            distribution: 'public',
            access: 'public',
            resourceTypes: [],
            enablementVariables: [],
            runtime: {
              browser: false,
              cache: false,
              daemon: false,
              search: false,
              documents: false,
              tableOfContents: false,
              authentication: false,
              status: false,
              enumeration: false,
            },
          },
          createMcpProvider: () => provider,
          createDataClient: () => ({
            search: async () => ({ results: [], failures: [] }),
            get: async () => { throw new Error('unused'); },
          }),
        },
      }),
    }];
    const runtime = await createServerRuntime({
      manifest,
      toolCallLimits: { maxActive: 1, maxQueued: 1, queueTimeoutMs: 5_000 },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'gate-test', version: '1.0.0' });

    await runtime.server.connect(serverTransport);
    await client.connect(clientTransport);
    const first = client.callTool({ name: 'gate_work', arguments: { id: 'first' } });
    await vi.waitFor(() => expect(started).toEqual(['first']));
    const second = client.callTool({ name: 'gate_work', arguments: { id: 'second' } });
    const shed = await client.callTool({ name: 'gate_work', arguments: { id: 'shed' } });
    expect(shed.isError).toBe(true);
    expect(JSON.stringify(shed.content)).toContain('TOOL_CALL_CAPACITY_EXCEEDED');
    expect(started).toEqual(['first']);

    releases.get('first')?.resolve({
      content: [{ type: 'text', text: 'first' }],
      isError: false,
    });
    await expect(first).resolves.toMatchObject({ isError: false });
    await vi.waitFor(() => expect(started).toEqual(['first', 'second']));
    releases.get('second')?.resolve({
      content: [{ type: 'text', text: 'second' }],
      isError: false,
    });
    await expect(second).resolves.toMatchObject({ isError: false });
    expect(maximumActive).toBe(1);

    await Promise.all([runtime.shutdown(), runtime.shutdown()]);
    expect(shutdown).toHaveBeenCalledOnce();
    await client.close();
  });
});

describe('MCP server update notice', () => {
  function manifestFor(provider: Provider): ProviderComponentReference[] {
    return [{
      id: 'notice',
      distribution: 'public',
      load: async () => ({
        component: {
          metadata: {
            id: 'notice',
            description: 'Update-notice test provider',
            distribution: 'public',
            access: 'public',
            resourceTypes: [],
            enablementVariables: [],
            runtime: {
              browser: false,
              cache: false,
              daemon: false,
              search: false,
              documents: false,
              tableOfContents: false,
              authentication: false,
              status: false,
              enumeration: false,
            },
          },
          createMcpProvider: () => provider,
          createDataClient: () => ({
            search: async () => ({ results: [], failures: [] }),
            get: async () => { throw new Error('unused'); },
          }),
        },
      }),
    }];
  }

  const provider: Provider = {
    name: 'notice',
    getTools: () => ['notice_search', 'notice_status'].map((name) => ({
      name,
      description: 'Return a fixed text.',
      inputSchema: z.object({}).strict(),
    })),
    handleToolCall: async (name) => ({ content: [{ type: 'text', text: name }], isError: false }),
    shutdown: async () => {},
  };

  function checkerWithNotice(): UpdateChecker {
    const checker = Object.create(UpdateChecker.prototype) as UpdateChecker;
    checker.notice = () => 'Update available: test notice';
    checker.refresh = async () => {};
    return checker;
  }

  async function connect(updateChecker?: UpdateChecker) {
    const runtime = await createServerRuntime({
      manifest: manifestFor(provider),
      ...(updateChecker ? { updateChecker } : {}),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'notice-test', version: '1.0.0' });
    await runtime.server.connect(serverTransport);
    await client.connect(clientTransport);
    return { runtime, client };
  }

  const texts = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as Array<{ text: string }>).map((item) => item.text);

  it('sends the notice as instructions and with the first and every status result', async () => {
    const { runtime, client } = await connect(checkerWithNotice());
    expect(client.getInstructions()).toBe('Update available: test notice');
    expect(texts(await client.callTool({ name: 'notice_search', arguments: {} })))
      .toEqual(['notice_search', 'Update available: test notice']);
    expect(texts(await client.callTool({ name: 'notice_search', arguments: {} })))
      .toEqual(['notice_search']);
    expect(texts(await client.callTool({ name: 'notice_status', arguments: {} })))
      .toEqual(['notice_status', 'Update available: test notice']);
    await runtime.shutdown();
    await client.close();
  });

  it('adds nothing without an update checker', async () => {
    const { runtime, client } = await connect();
    expect(client.getInstructions()).toBeUndefined();
    expect(texts(await client.callTool({ name: 'notice_status', arguments: {} })))
      .toEqual(['notice_status']);
    await runtime.shutdown();
    await client.close();
  });

  it('sends operator instructions to the model at startup', async () => {
    const runtime = await createServerRuntime({
      manifest: manifestFor(provider),
      operatorInstructions: ['Tell the user that Redis is deprecated.'],
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'operator-notice-test', version: '1.0.0' });
    await runtime.server.connect(serverTransport);
    await client.connect(clientTransport);

    expect(client.getInstructions()).toBe('Tell the user that Redis is deprecated.');

    await runtime.shutdown();
    await client.close();
  });
});
