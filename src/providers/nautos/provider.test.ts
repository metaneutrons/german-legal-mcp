import { describe, expect, it, vi } from 'vitest';
import type { NautosClient } from './client.js';
import { NautosProvider } from './provider.js';

function fakeClient() {
  return {
    search: vi.fn(async () => ({
      count: 1,
      items: [{
        acCode: 'A1',
        documentNumber: 'DIN 1',
        title: 'Standard',
        dateOfIssue: '2025-01-01',
        documentType: ['DIN'],
        score: 1,
      }],
    })),
  } as unknown as NautosClient;
}

describe('NautosProvider', () => {
  it('uses an injected client for search', async () => {
    const client = fakeClient();
    const provider = new NautosProvider(client);
    await expect(provider.handleToolCall('nautos_search', {
      query: 'DIN 1',
      limit: 2,
    })).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('A1') }],
    });
    expect(client.search).toHaveBeenCalledWith('DIN 1', 2);
  });

  it('formats empty and unknown results', async () => {
    const client = fakeClient();
    client.search = vi.fn(async () => ({ count: 0, items: [] }));
    const provider = new NautosProvider(client);
    await expect(provider.handleToolCall('nautos_search', { query: 'none' }))
      .resolves.toMatchObject({
        content: [{ text: expect.stringContaining('No results') }],
      });
    await expect(provider.handleToolCall('nautos_unknown', {}))
      .resolves.toMatchObject({ isError: true });
  });
});
