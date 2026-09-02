import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ToolCallCancelledError,
  ToolCallCapacityError,
  ToolCallGate,
  type ToolCallGateLimits,
} from './tool-call-gate.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe('ToolCallGate', () => {
  it('caps active work, queues FIFO and sheds beyond the aggregate bound', async () => {
    const gate = new ToolCallGate({ maxActive: 2, maxQueued: 2, queueTimeoutMs: 1_000 });
    const releases = Array.from({ length: 4 }, () => deferred<string>());
    const started: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const run = (index: number) => gate.run(async () => {
      started.push(index);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        return await releases[index]!.promise;
      } finally {
        active -= 1;
      }
    });

    const calls = [0, 1, 2, 3].map(run);
    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    await expect(run(4)).rejects.toBeInstanceOf(ToolCallCapacityError);

    releases[0]!.resolve('zero');
    await expect(calls[0]).resolves.toBe('zero');
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    releases[1]!.resolve('one');
    await expect(calls[1]).resolves.toBe('one');
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));

    releases[2]!.resolve('two');
    releases[3]!.resolve('three');
    await expect(Promise.all(calls.slice(2))).resolves.toEqual(['two', 'three']);
    expect(maximumActive).toBe(2);
    await expect(gate.whenIdle()).resolves.toBeUndefined();
  });

  it('expires and cancels queued calls without consuming a later slot', async () => {
    vi.useFakeTimers();
    const gate = new ToolCallGate({ maxActive: 1, maxQueued: 2, queueTimeoutMs: 100 });
    const active = deferred<void>();
    const first = gate.run(() => active.promise);
    const timedOut = gate.run(async () => 'late');
    const controller = new globalThis.AbortController();
    const cancelled = gate.run(async () => 'cancelled', controller.signal);
    const timeoutAssertion = expect(timedOut).rejects.toBeInstanceOf(ToolCallCapacityError);
    const cancellationAssertion = expect(cancelled).rejects
      .toBeInstanceOf(ToolCallCancelledError);

    controller.abort();
    await cancellationAssertion;
    await vi.advanceTimersByTimeAsync(100);
    await timeoutAssertion;

    active.resolve();
    await expect(first).resolves.toBeUndefined();
    await expect(gate.run(async () => 'next')).resolves.toBe('next');
  });

  it('rejects queued and future calls when closed but lets active work settle', async () => {
    const gate = new ToolCallGate({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 1_000 });
    const release = deferred<string>();
    const active = gate.run(() => release.promise);
    const queued = gate.run(async () => 'queued');

    gate.close();
    await expect(queued).rejects.toBeInstanceOf(ToolCallCapacityError);
    await expect(gate.run(async () => 'future')).rejects.toBeInstanceOf(ToolCallCapacityError);

    release.resolve('active');
    await expect(active).resolves.toBe('active');
    await expect(gate.whenIdle()).resolves.toBeUndefined();
  });

  it('closes the abort-listener race and releases capacity before publishing a result', async () => {
    const gate = new ToolCallGate({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 1_000 });
    const release = deferred<void>();
    const first = gate.run(() => release.promise);
    let abortReads = 0;
    const racedSignal = {
      get aborted() {
        abortReads += 1;
        return abortReads >= 2;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as NonNullable<Parameters<ToolCallGate['run']>[1]>;
    const raced = gate.run(async () => 'must-not-run', racedSignal);
    await expect(raced).rejects.toBeInstanceOf(ToolCallCancelledError);

    release.resolve();
    await expect(first.then(() => gate.run(async () => 'next'))).resolves.toBe('next');
  });

  it('rejects invalid limits at construction', () => {
    expect(() => new ToolCallGate({ maxActive: 0, maxQueued: 1, queueTimeoutMs: 1 }))
      .toThrow(RangeError);
    expect(() => new ToolCallGate({ maxActive: 1, maxQueued: -1, queueTimeoutMs: 1 }))
      .toThrow(RangeError);
    expect(() => new ToolCallGate({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 0 }))
      .toThrow(RangeError);
    expect(() => new ToolCallGate({ maxActive: 1 } as ToolCallGateLimits))
      .toThrow(RangeError);
  });
});
