import { describe, expect, it, vi } from 'vitest';
import type { TechnicalStandardReference } from '../../contracts/legal-resource.js';
import type { NautosClient } from './client.js';
import { NautosDataClient, type NautosAuthenticationAdapter } from './data-client.js';

function client(withFullText = true): NautosClient {
  return {
    search: vi.fn(async () => ({
      count: 1,
      items: [{
        acCode: 'A1', documentNumber: 'DIN 1', title: 'Datenschutzstandard',
        titleEn: 'Privacy standard', dateOfIssue: '2026-01-01',
        documentType: ['DIN'], score: 1,
      }],
    })),
    getDetail: vi.fn(async () => ({
      acCode: 'A1', documentNumber: 'DIN 1', titleDe: 'Datenschutzstandard',
      titleEn: 'Privacy standard', dateOfIssue: '2026-01-01', valid: true,
      documentType: ['DIN'], classificationIcs: ['35.030'],
      ...(withFullText ? { din21Id: 'D21', format: 'html' } : {}),
    })),
    getToc: vi.fn(async () => [{
      id: 's1', label: '1', title: 'Scope',
      section: [{ id: 's1.1', title: 'Details' }],
    }]),
    getSection: vi.fn(async () => '<p>section</p>'),
  } as unknown as NautosClient;
}

function auth(): NautosAuthenticationAdapter {
  return {
    getSnapshot: vi.fn(() => ({ authenticated: true, expiresAt: 2_000_000_000 })),
    refresh: vi.fn(async () => ({ authenticated: true, expiresAt: 2_000_000_100 })),
    clear: vi.fn(),
  };
}

describe('NautosDataClient', () => {
  it('normalizes standard search, metadata and native TOC', async () => {
    const data = new NautosDataClient(client(), auth());
    const page = await data.search({ query: 'DIN 1', limit: 2 });
    expect(page.results[0]).toMatchObject({
      resourceType: 'technical-standard', documentNumber: 'DIN 1',
      standardBodies: ['DIN'], provenance: { providerId: 'nautos' },
    });
    expect((await data.get(page.results[0]!)).reference).toMatchObject({ valid: true });
    expect((await data.get(page.results[0]!)).content.value).toContain('ICS: 35.030');
    expect(await data.getTableOfContents(page.results[0]!)).toMatchObject({
      origin: 'native',
      entries: [{ id: 's1', label: '1', children: [{ id: 's1.1', level: 1 }] }],
    });
  });

  it('filters unsupported resource and source requests', async () => {
    const data = new NautosDataClient(client(), auth());
    await expect(data.search({ query: 'x', resourceTypes: ['case-law'] }))
      .resolves.toEqual({ results: [], failures: [] });
    await expect(data.search({ query: 'x', sourceIds: ['other'] }))
      .resolves.toEqual({ results: [], failures: [] });
  });

  it('exposes portable authentication and provider-specific methods', async () => {
    const transport = client();
    const authentication = auth();
    const data = new NautosDataClient(transport, authentication);
    await expect(data.getAuthenticationStatus()).resolves.toMatchObject({
      state: 'authenticated', method: 'credentials', expiresAt: expect.any(String),
    });
    await expect(data.refreshAuthentication()).resolves.toMatchObject({ state: 'authenticated' });
    await data.logout();
    expect(authentication.clear).toHaveBeenCalledOnce();
    await data.searchStandards('DIN', 1);
    await data.getSection('D21', 's1');
    expect(transport.search).toHaveBeenCalledWith('DIN', 1);
  });

  it('rejects missing full text and foreign references', async () => {
    const data = new NautosDataClient(client(false), auth());
    const reference = {
      resourceType: 'technical-standard',
      title: 'DIN 1',
      provenance: { providerId: 'nautos', sourceId: 'nautos', providerDocumentId: 'A1' },
      rights: { access: 'credentialed', fullTextStorage: 'cache-only', redistribution: 'prohibited' },
    } as TechnicalStandardReference;
    await expect(data.getTableOfContents(reference)).rejects.toThrow('No full text');
    await expect(data.get({
      ...reference,
      provenance: { ...reference.provenance, providerId: 'other' },
    })).rejects.toThrow('does not belong');
  });
});
