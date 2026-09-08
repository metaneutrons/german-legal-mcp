import { describe, expect, it, vi } from 'vitest';
import type { ArxivClient, ArxivEntry } from './client.js';
import { ArxivProvider } from './provider.js';

const entry: ArxivEntry = {
  id: '2501.00001',
  title: 'Legal AI',
  summary: 'Summary',
  authors: ['A', 'B'],
  published: '2025-01-01',
  updated: '2025-01-02',
  categories: ['cs.CY'],
  primaryCategory: 'cs.CY',
  doi: '10.1/example',
  journalRef: 'Journal',
  pdfUrl: 'https://arxiv.org/pdf/2501.00001',
  htmlUrl: 'https://arxiv.org/html/2501.00001',
};

function fakeClient(entries = [entry], html: string | null = '<h1>Intro</h1><p>Body</p>') {
  return {
    search: vi.fn(async () => ({ total: entries.length, entries })),
    getHtml: vi.fn(async () => html),
  } as unknown as ArxivClient;
}

describe('ArxivProvider', () => {
  it('formats search, accepts the legacy alias, and retrieves full text', async () => {
    const client = fakeClient();
    const provider = new ArxivProvider(client);

    await expect(provider.handleToolCall('arxiv:search', {
      query: 'law',
      limit: 5,
      sort_by: 'relevance',
    })).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('2501.00001') }],
    });
    await expect(provider.handleToolCall('arxiv_get', {
      id: entry.id,
    })).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('Summary') }],
    });
    await expect(provider.handleToolCall('arxiv_get', {
      id: entry.id,
      section: 'Intro',
    })).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('# Intro') }],
    });
  });

  it('handles missing papers, unavailable HTML and unknown tools', async () => {
    await expect(new ArxivProvider(fakeClient([])).handleToolCall(
      'arxiv_get',
      { id: 'missing' },
    )).resolves.toMatchObject({ isError: true });
    await expect(new ArxivProvider(fakeClient([entry], null)).handleToolCall(
      'arxiv_get',
      { id: entry.id, section: 'Intro' },
    )).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('Full HTML text not available') }],
    });
    await expect(new ArxivProvider(fakeClient()).handleToolCall(
      'arxiv:unknown',
      {},
    )).resolves.toMatchObject({ isError: true });
  });
});
