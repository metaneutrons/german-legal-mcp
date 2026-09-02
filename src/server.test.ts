import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderComponentReference } from './contracts/provider-component.js';
import { createServerRuntime } from './server.js';
import type { Provider, ToolResult } from './shared/types.js';

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
