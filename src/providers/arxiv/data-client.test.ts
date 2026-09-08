import { describe, expect, it, vi } from 'vitest';
import type { LiteratureReference } from '../../contracts/legal-resource.js';
import type { ArxivClient, ArxivEntry } from './client.js';
import { ArxivDataClient } from './data-client.js';

const entry: ArxivEntry = {
  id: '2601.1',
  title: 'Legal AI',
  summary: 'Abstract text',
  authors: ['Ada'],
  published: '2026-01-01',
  updated: '2026-01-02',
  categories: ['cs.CY'],
  primaryCategory: 'cs.CY',
  doi: '10.1/test',
  journalRef: 'Law Journal',
  pdfUrl: 'https://arxiv.org/pdf/2601.1',
  htmlUrl: 'https://arxiv.org/html/2601.1',
};

function client(html: string | null = '<h1>Body</h1><p>Text</p>'): ArxivClient {
  return {
    search: vi.fn(async (params) => ({
      total: 1,
      entries: 'id_list' in params && params.id_list === 'missing' ? [] : [entry],
    })),
    getHtml: vi.fn(async () => html),
  } as unknown as ArxivClient;
}

describe('ArxivDataClient', () => {
  it('normalizes searches and full documents', async () => {
    const data = new ArxivDataClient(client());
    const page = await data.search({ query: 'law', limit: 3, cursor: '5' });
    expect(page.results[0]).toMatchObject({
      resourceType: 'literature',
      title: 'Legal AI',
      authors: ['Ada'],
      doi: '10.1/test',
      provenance: { providerId: 'arxiv', providerDocumentId: '2601.1' },
    });
    const document = await data.get(page.results[0]!);
    expect(document.content.value).toContain('# Body');
  });

  it('filters unsupported requests and handles abstract-only papers', async () => {
    const data = new ArxivDataClient(client(null));
    await expect(data.search({ query: 'x', resourceTypes: ['case-law'] }))
      .resolves.toEqual({ results: [], failures: [] });
    await expect(data.search({ query: 'x', sourceIds: ['other'] }))
      .resolves.toEqual({ results: [], failures: [] });
    const [reference] = (await data.search({ query: 'x' })).results;
    expect((await data.get(reference!)).content.value).toContain('Abstract text');
    await expect(data.get({
      ...reference!,
      provenance: { ...reference!.provenance, providerId: 'other' },
    } as LiteratureReference)).rejects.toThrow('does not belong');
    await expect(data.get({
      ...reference!,
      provenance: { ...reference!.provenance, providerDocumentId: 'missing' },
    })).rejects.toThrow('not found');
  });
});
