import { describe, expect, it, vi } from 'vitest';
import {
  LegislationClient,
  PUBLIC_LEGISLATION_RIGHTS,
} from './client.js';
import type { LegisAdapter } from './types.js';

function fixtureAdapter(source: string, title: string): LegisAdapter {
  return {
    states: [source],
    search: vi.fn(async () => [{
      id: `${source}-law`,
      title,
      subtitle: `${source} legislation portal`,
      date: '2026-08-03',
      url: `https://example.test/${source}/law`,
    }]),
    get: vi.fn(async () => ({
      title,
      content: '# § 1 Purpose\n\nNormalized legislation text.',
      url: `https://example.test/${source}/law`,
    })),
  };
}

describe('LegislationClient component contract', () => {
  it('returns normalized German legislation references and documents', async () => {
    const client = new LegislationClient([
      fixtureAdapter('NW', 'North Rhine-Westphalia Data Protection Act'),
    ]);

    const page = await client.search({
      query: 'data protection',
      jurisdictions: ['DE-NW'],
      resourceTypes: ['legislation'],
    });

    expect(page.failures).toEqual([]);
    expect(page.results).toEqual([expect.objectContaining({
      resourceType: 'legislation',
      jurisdiction: 'DE-NW',
      language: 'de',
      provenance: {
        providerId: 'de-legislation',
        sourceId: 'de-legislation:NW',
        providerDocumentId: 'NW-law',
        canonicalUrl: 'https://example.test/NW/law',
      },
    })]);

    const reference = page.results[0];
    expect(reference).toBeDefined();
    if (!reference) return;
    await expect(client.get(reference)).resolves.toEqual(expect.objectContaining({
      content: {
        format: 'markdown',
        value: '# § 1 Purpose\n\nNormalized legislation text.',
      },
    }));
  });

  it('isolates source failures and attributes them correctly', async () => {
    const failing: LegisAdapter = {
      states: ['BE'],
      search: vi.fn(async () => { throw new Error('BE unavailable'); }),
      get: vi.fn(),
    };
    const client = new LegislationClient([
      fixtureAdapter('NW', 'North Rhine-Westphalia Act'),
      failing,
      fixtureAdapter('BY', 'Bavarian Act'),
    ]);

    const page = await client.search({ query: 'act' });

    expect(page.results).toHaveLength(2);
    expect(page.failures).toEqual([expect.objectContaining({
      sourceId: 'de-legislation:BE',
      message: 'BE unavailable',
    })]);
  });

  it('supports another member state without a country-specific client fork', async () => {
    const client = new LegislationClient(
      [fixtureAdapter('LEGIFRANCE', 'Loi Informatique et Libertés')],
      {
        providerId: 'fr-legislation',
        language: 'fr',
        locale: 'fr-FR',
        rights: PUBLIC_LEGISLATION_RIGHTS,
        jurisdictionForSource: () => 'FR',
        sourceForJurisdiction: (jurisdiction) =>
          jurisdiction.toUpperCase() === 'FR' ? 'LEGIFRANCE' : undefined,
      },
    );

    const page = await client.search({ query: 'informatique', jurisdictions: ['FR'] });

    expect(page.results).toEqual([expect.objectContaining({
      jurisdiction: 'FR',
      language: 'fr',
      provenance: expect.objectContaining({
        providerId: 'fr-legislation',
        sourceId: 'fr-legislation:LEGIFRANCE',
      }),
    })]);
  });

  it('derives a table of contents when an adapter has no structured endpoint', async () => {
    const client = new LegislationClient([fixtureAdapter('NW', 'Act')]);

    await expect(client.getTableOfContents('NW', 'NW-law')).resolves.toEqual([
      { depth: 0, num: '§ 1', title: 'Purpose' },
    ]);
  });
});
