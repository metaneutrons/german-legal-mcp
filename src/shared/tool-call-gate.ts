import { RecoverableError } from './errors.js';

export interface ToolCallGateLimits {
  readonly maxActive: number;
  readonly maxQueued: number;
  readonly queueTimeoutMs: number;
}

export const DEFAULT_TOOL_CALL_LIMITS: ToolCallGateLimits = Object.freeze({
  maxActive: 4,
  maxQueued: 16,
  queueTimeoutMs: 30_000,
});

export class ToolCallCapacityError extends RecoverableError {
  override readonly code = 'TOOL_CALL_CAPACITY_EXCEEDED';
  override readonly userMessage = 'The MCP server is busy and cannot accept another tool call.';
  override readonly recoveryHint = 'Retry after an in-flight tool call completes.';
}

export class ToolCallCancelledError extends RecoverableError {
  override readonly code = 'TOOL_CALL_CANCELLED';
  override readonly userMessage = 'The tool call was cancelled before it could run.';
  override readonly recoveryHint = 'Retry only if the result is still needed.';
}

interface QueueEntry {
  readonly operation: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly signal: AbortSignal | undefined;
  timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  abort: (() => void) | undefined;
  settled: boolean;
}

/**
 * Process-wide admission control for MCP tool calls.
 *
 * Providers retain their own narrower queues and rate limits; this gate is the
 * outer availability boundary that caps aggregate fan-out, response memory and
 * queued request objects across every provider.
 */
export class ToolCallGate {
  private active = 0;
  private readonly queue: QueueEntry[] = [];
  private readonly idleWaiters = new Set<() => void>();
  private closed = false;

  constructor(private readonly limits: ToolCallGateLimits = DEFAULT_TOOL_CALL_LIMITS) {
    const fields = [
      ['maxActive', limits.maxActive, 1],
      ['maxQueued', limits.maxQueued, 0],
      ['queueTimeoutMs', limits.queueTimeoutMs, 1],
    ] as const;
    for (const [name, value, minimum] of fields) {
      if (!Number.isSafeInteger(value) || value < minimum) {
        throw new RangeError(`Invalid tool-call gate limit ${name}`);
      }
    }
  }

  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) {
      return Promise.reject(new ToolCallCapacityError('The MCP tool-call gate is closed'));
    }
    if (signal?.aborted) {
      return Promise.reject(new ToolCallCancelledError('Tool call was already cancelled'));
    }
    if (this.active >= this.limits.maxActive && this.queue.length >= this.limits.maxQueued) {
      return Promise.reject(new ToolCallCapacityError(
        `Tool-call capacity is full (${this.active} active, ${this.queue.length} queued)`,
      ));
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        operation,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
        timer: undefined,
        abort: undefined,
        settled: false,
      };
      if (this.active < this.limits.maxActive) {
        this.start(entry);
      } else {
        this.enqueue(entry);
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.queue.splice(0)) {
      this.rejectQueued(entry, new ToolCallCapacityError('The MCP server is shutting down'));
    }
    this.resolveIdleIfNeeded();
  }

  whenIdle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private enqueue(entry: QueueEntry): void {
    this.queue.push(entry);
    entry.timer = globalThis.setTimeout(() => {
      this.removeQueued(entry);
      this.rejectQueued(entry, new ToolCallCapacityError(
        `Tool call exceeded the ${this.limits.queueTimeoutMs}ms admission wait limit`,
      ));
    }, this.limits.queueTimeoutMs);
    entry.timer.unref?.();
    if (entry.signal) {
      entry.abort = () => {
        this.removeQueued(entry);
        this.rejectQueued(entry, new ToolCallCancelledError(
          'Tool call was cancelled while waiting for admission',
        ));
      };
      entry.signal.addEventListener('abort', entry.abort, { once: true });
      // AbortSignal does not replay an abort event to a listener installed
      // after cancellation. Close the check/listener race explicitly.
      if (entry.signal.aborted) entry.abort();
    }
  }

  private start(entry: QueueEntry): void {
    if (entry.settled) return;
    this.cleanupQueued(entry);
    if (entry.signal?.aborted) {
      this.rejectQueued(entry, new ToolCallCancelledError(
        'Tool call was cancelled before provider dispatch',
      ));
      return;
    }
    this.active += 1;
    void Promise.resolve()
      .then(entry.operation)
      .then(
        (value) => this.finishActive(entry, () => entry.resolve(value)),
        (error: unknown) => this.finishActive(entry, () => entry.reject(error)),
      );
  }

  private drain(): void {
    while (!this.closed && this.active < this.limits.maxActive && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) this.start(next);
    }
    this.resolveIdleIfNeeded();
  }

  private removeQueued(entry: QueueEntry): void {
    const index = this.queue.indexOf(entry);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private finishActive(entry: QueueEntry, publish: () => void): void {
    entry.settled = true;
    this.active -= 1;
    this.drain();
    // Publish only after the slot has been released, so a caller reacting to
    // this result observes the true capacity state.
    publish();
  }

  private rejectQueued(entry: QueueEntry, error: Error): void {
    if (entry.settled) return;
    entry.settled = true;
    this.cleanupQueued(entry);
    entry.reject(error);
    this.resolveIdleIfNeeded();
  }

  private cleanupQueued(entry: QueueEntry): void {
    if (entry.timer) globalThis.clearTimeout(entry.timer);
    if (entry.abort && entry.signal) entry.signal.removeEventListener('abort', entry.abort);
    entry.timer = undefined;
    entry.abort = undefined;
  }

  private resolveIdleIfNeeded(): void {
    if (this.active !== 0 || this.queue.length !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
