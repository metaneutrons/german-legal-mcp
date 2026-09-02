import { describe, expect, it } from 'vitest';

describe('package root', () => {
  it('is import-safe and does not install process or stdin handlers', async () => {
    const events = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'] as const;
    const before = Object.fromEntries(events.map((event) => [event, process.listenerCount(event)]));
    const stdinCloseBefore = process.stdin.listenerCount('close');

    const api = await import('./index.js');

    expect(api.createServerRuntime).toBeTypeOf('function');
    expect(api.ProviderRegistry).toBeTypeOf('function');
    for (const event of events) expect(process.listenerCount(event)).toBe(before[event]);
    expect(process.stdin.listenerCount('close')).toBe(stdinCloseBefore);
  });
});
