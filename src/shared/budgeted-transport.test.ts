import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { describe, expect, it, vi } from 'vitest';
import { budgetedTransport } from './budgeted-transport.js';

describe('incoming transport budget', () => {
  it('rejects adversarial arrays before SDK validation and accepts the next request', async () => {
    const inner: Transport = { start: vi.fn(), send: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
    const outer = budgetedTransport(inner);
    outer.onmessage = vi.fn();
    outer.onerror = vi.fn();
    await outer.start();
    inner.onmessage?.({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { values: Array(257).fill(null) } });
    expect(outer.onmessage).not.toHaveBeenCalled();
    expect(outer.onerror).toHaveBeenCalledOnce();
    expect(inner.send).toHaveBeenCalledWith({
      jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Incoming message exceeds input limits.' },
    });
    const next = { jsonrpc: '2.0' as const, id: 2, method: 'tools/list' };
    inner.onmessage?.(next);
    expect(outer.onmessage).toHaveBeenCalledWith(next, undefined);
  });

  it('does not reply to oversized notifications or responses', async () => {
    const inner: Transport = { start: vi.fn(), send: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
    const outer = budgetedTransport(inner);
    outer.onmessage = vi.fn();
    await outer.start();
    inner.onmessage?.({ jsonrpc: '2.0', method: 'notifications/test', params: { values: Array(257).fill(null) } });
    inner.onmessage?.({ jsonrpc: '2.0', id: 1, result: { values: Array(257).fill(null) } });
    expect(inner.send).not.toHaveBeenCalled();
    expect(outer.onmessage).not.toHaveBeenCalled();
  });
});
