import { describe, expect, it, vi } from 'vitest';
import { CaseLawClient, PUBLIC_CASE_LAW_RIGHTS } from './client.js';
import type { DecisionAdapter } from './types.js';

function fixtureAdapter(
  source: string,
  title: string,
): DecisionAdapter {
  return {
    sources: [source],
    search: vi.fn(async () => [{
      id: `${source}-1`,
      title,
      subtitle: `${source} portal`,
      date: '2026-08-03',
      court: 'Verwaltungsgericht',
      fileNumber: '1 A 1/26',
      ecli: `ECLI:DE:${source}:2026:1A1.26.00`,
      url: `https://example.test/${source}/1`,
    }]),
    get: vi.fn(async () => ({
      title,
      content: 'Normalized full decision text.',
      url: `https://example.test/${source}/1`,
      court: 'Verwaltungsgericht',
      date: '2026-08-03',
      fileNumber: '1 A 1/26',
      ecli: `ECLI:DE:${source}:2026:1A1.26.00`,
    })),
  };
}

describe('CaseLawClient component contract', () => {
  it('returns transport-neutral references and documents for application consumers', async () => {
    const client = new CaseLawClient([
      fixtureAdapter('BUND', 'Federal decision'),
      fixtureAdapter('NW', 'North Rhine-Westphalia decision'),
    ]);

    const page = await client.search({
      query: 'data protection',
      jurisdictions: ['DE-NW'],
      resourceTypes: ['case-law'],
      limit: 5,
    });

    expect(page.failures).toEqual([]);
    expect(page.results).toEqual([expect.objectContaining({
      resourceType: 'case-law',
      jurisdiction: 'DE-NW',
      title: 'North Rhine-Westphalia decision',
      provenance: expect.objectContaining({
        providerId: 'de-case-law',
        sourceId: 'de-case-law:NW',
        providerDocumentId: 'NW-1',
      }),
      rights: {
        access: 'public',
        fullTextStorage: 'allowed',
        redistribution: 'unknown',
        // SPDX, separate from the policy above: the licence is the fact, the
        // policy is our reading of it. NOASSERTION pairs with 'unknown' and
        // means nobody has determined it yet — not that there is none.
        licence: 'NOASSERTION',
      },
    })]);

    const reference = page.results[0];
    expect(reference).toBeDefined();
    if (!reference) return;
    await expect(client.get(reference)).resolves.toEqual(expect.objectContaining({
      content: { format: 'markdown', value: 'Normalized full decision text.' },
    }));
  });

  it('attributes partial failures to the actual source', async () => {
    const failing: DecisionAdapter = {
      sources: ['NW'],
      search: vi.fn(async () => { throw new Error('NW unavailable'); }),
      get: vi.fn(),
    };
    const client = new CaseLawClient([
      fixtureAdapter('BUND', 'Federal decision'),
      failing,
      fixtureAdapter('BY', 'Bavarian decision'),
    ]);

    const page = await client.search({ query: 'privacy' });

    expect(page.results).toHaveLength(2);
    expect(page.failures).toEqual([expect.objectContaining({
      sourceId: 'de-case-law:NW',
      message: 'NW unavailable',
    })]);
  });

  it('preserves search metadata when a detail page omits its heading and metadata', async () => {
    const adapter = fixtureAdapter('BUND', 'Federal search title');
    adapter.get = vi.fn(async () => ({
      title: '',
      content: 'Normalized full decision text.',
      url: '',
      court: '',
      date: '',
      fileNumber: '',
    }));
    const client = new CaseLawClient([adapter]);
    const page = await client.search({ query: 'privacy', limit: 1 });
    const reference = page.results[0];
    expect(reference).toBeDefined();
    if (!reference) return;

    const document = await client.get(reference);

    expect(document.reference).toMatchObject({
      title: 'Federal search title',
      decisionDate: '2026-08-03',
      court: 'Verwaltungsgericht',
      fileNumber: '1 A 1/26',
      ecli: 'ECLI:DE:BUND:2026:1A1.26.00',
      provenance: {
        canonicalUrl: 'https://example.test/BUND/1',
      },
    });
  });

  it('supports another EU member state through configuration instead of a fork', async () => {
    const client = new CaseLawClient(
      [fixtureAdapter('RIS', 'Austrian decision')],
      {
        providerId: 'at-case-law',
        language: 'de',
        locale: 'de-AT',
        rights: PUBLIC_CASE_LAW_RIGHTS,
        jurisdictionForSource: () => 'AT',
        sourceForJurisdiction: (jurisdiction) =>
          jurisdiction.toUpperCase() === 'AT' ? 'RIS' : undefined,
      },
    );

    const page = await client.search({ query: 'Datenschutz', jurisdictions: ['AT'] });

    expect(page.results).toEqual([expect.objectContaining({
      jurisdiction: 'AT',
      provenance: expect.objectContaining({
        providerId: 'at-case-law',
        sourceId: 'at-case-law:RIS',
      }),
    })]);
  });
});

describe('CaseLawClient enumeration', () => {
  /** An adapter that can be walked, yielding `count` synthetic entries. */
  function enumerableAdapter(source: string, count: number): DecisionAdapter {
    const ids = Array.from({ length: count }, (_, i) => `${source}-${i + 1}`);
    return {
      ...fixtureAdapter(source, `${source} decision`),
      enumerate: vi.fn(async (_source: string, request = {}) => {
        const limit = request.limit ?? 1000;
        const start = request.cursor ? ids.indexOf(request.cursor) + 1 : 0;
        const page = ids.slice(start, start + limit);
        const last = page.at(-1);
        return {
          results: page.map((id) => ({ id, title: id, subtitle: '', date: '2026-08-03' })),
          ...(last && start + page.length < ids.length ? { nextCursor: last } : {}),
          origin: 'derived' as const,
        };
      }),
    };
  }

  it('walks every enumerable source in turn and stops when all are exhausted', async () => {
    const client = new CaseLawClient([
      enumerableAdapter('BUND', 3),
      enumerableAdapter('NW', 2),
    ]);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.enumerate({ limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.results.map((r) => r.provenance.providerDocumentId));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual(['BUND-1', 'BUND-2', 'BUND-3', 'NW-1', 'NW-2']);
  });

  it('maps enumerated entries to the same reference shape search produces', async () => {
    const client = new CaseLawClient([enumerableAdapter('BUND', 1)]);
    const page = await client.enumerate();

    expect(page.origin).toBe('derived');
    expect(page.results).toEqual([expect.objectContaining({
      resourceType: 'case-law',
      jurisdiction: 'DE',
      provenance: expect.objectContaining({
        providerId: 'de-case-law',
        sourceId: 'de-case-law:BUND',
        providerDocumentId: 'BUND-1',
      }),
      rights: PUBLIC_CASE_LAW_RIGHTS,
    })]);
  });

  it('reports non-enumerable sources once, when the walk starts', async () => {
    const client = new CaseLawClient([
      enumerableAdapter('BUND', 3),
      fixtureAdapter('NW', 'search-only portal'),
    ]);

    const first = await client.enumerate({ limit: 2 });
    expect(first.failures).toEqual([expect.objectContaining({ sourceId: 'de-case-law:NW' })]);

    // Repeating the notice on every page would bury real failures behind it.
    const second = await client.enumerate({ limit: 2, cursor: first.nextCursor as string });
    expect(second.failures).toEqual([]);
  });

  it('narrows the walk by jurisdiction, like search does', async () => {
    const client = new CaseLawClient([
      enumerableAdapter('BUND', 2),
      enumerableAdapter('NW', 2),
    ]);
    const page = await client.enumerate({ jurisdictions: ['DE-NW'] });
    expect(page.results.map((r) => r.provenance.providerDocumentId)).toEqual(['NW-1', 'NW-2']);
  });

  it('rejects a malformed cursor rather than silently restarting the walk', async () => {
    const client = new CaseLawClient([enumerableAdapter('BUND', 2)]);
    await expect(client.enumerate({ cursor: 'not-a-cursor' })).rejects.toThrow(/cursor/i);
  });
});
