import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { assertInputBudget, InputBudgetError } from './input-budget.js';

/** Bound all incoming messages before SDK request schemas can accumulate issues. */
export function budgetedTransport(inner: Transport): Transport {
  const outer: Transport = {
    async start() {
      inner.onclose = () => outer.onclose?.();
      inner.onerror = (error) => outer.onerror?.(error);
      inner.onmessage = (message, extra) => {
        try {
          assertInputBudget(message);
        } catch (error) {
          if (!(error instanceof InputBudgetError)) throw error;
          outer.onerror?.(error);
          // Notifications and responses must never cause a response loop.
          if ('method' in message && 'id' in message) {
            void inner.send({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32602, message: 'Incoming message exceeds input limits.' },
            }).catch((reason: unknown) => {
              outer.onerror?.(reason instanceof Error ? reason : new Error('Transport send failed'));
            });
          }
          return;
        }
        outer.onmessage?.(message, extra);
      };
      await inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
  };
  if (inner.setProtocolVersion) {
    outer.setProtocolVersion = (version) => inner.setProtocolVersion?.(version);
  }
  return outer;
}
