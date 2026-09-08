import { describe, expect, it, vi } from 'vitest';
import type { ParliamentaryMaterialReference } from '../../contracts/legal-resource.js';
import type { DipClient, DipDocument } from './client.js';
import { DipDataClient } from './data-client.js';

const document: DipDocument = {
  id: 'D1',
  titel: '  Gesetzentwurf\r\nzum Test  ',
  datum: '2026-01-01',
  dokumentnummer: '21/1',
  wahlperiode: 21,
  herausgeber: 'Bundestag',
  text: 'Volltext',
  fundstelle: { pdf_url: 'https://example.test/d1.pdf' },
};

function client(found: DipDocument | null = document): DipClient {
  const result = { numFound: found ? 1 : 0, documents: found ? [found] : [], cursor: 'next' };
  return {
    searchDrucksachen: vi.fn(async () => result),
    searchDrucksachenText: vi.fn(async () => result),
    searchVorgang: vi.fn(async () => result),
    searchPlenarprotokollText: vi.fn(async () => result),
    getDrucksache: vi.fn(async () => found),
  } as unknown as DipClient;
}

describe('DipDataClient', () => {
  it('normalizes parliamentary search, cursor and content', async () => {
    const data = new DipDataClient(client());
    const page = await data.search({ query: 'Entwurf', limit: 2, cursor: 'old' });
    expect(page.nextCursor).toBe('next');
    expect(page.results[0]).toMatchObject({
      resourceType: 'parliamentary-material',
      title: 'Gesetzentwurf zum Test',
      documentNumber: '21/1',
      legislativePeriod: 21,
      issuer: 'Bundestag',
    });
    expect((await data.get(page.results[0]!)).content.value).toBe('Volltext');
  });

  it('filters scope and validates ownership and missing documents', async () => {
    const data = new DipDataClient(client(null));
    for (const request of [
      { query: 'x', resourceTypes: ['case-law'] as const },
      { query: 'x', jurisdictions: ['AT'] },
      { query: 'x', sourceIds: ['other'] },
    ]) {
      await expect(data.search(request)).resolves.toEqual({ results: [], failures: [] });
    }
    const reference = {
      resourceType: 'parliamentary-material',
      title: 'x',
      provenance: { providerId: 'dip', sourceId: 'dip:bundestag', providerDocumentId: 'missing' },
      rights: { access: 'public', fullTextStorage: 'allowed', redistribution: 'unknown' },
    } as ParliamentaryMaterialReference;
    await expect(data.get(reference)).rejects.toThrow('not found');
    await expect(data.get({
      ...reference,
      provenance: { ...reference.provenance, providerId: 'other' },
    })).rejects.toThrow('does not belong');
  });
});

describe('DipDataClient enumeration', () => {
  function transport(pages: { documents: unknown[]; cursor?: string }[]) {
    const searchDrucksachen = vi.fn(async () => pages.shift() ?? { documents: [], cursor: undefined });
    return { client: { searchDrucksachen } as never, searchDrucksachen };
  }

  const doc = (id: string) => ({
    id, titel: 'Kleine Anfrage', datum: '2026-08-07',
    dokumentnummer: '21/7522', wahlperiode: 21, herausgeber: 'BT',
  });

  it('filters server-side on aktualisiert and reports native origin', async () => {
    const { client, searchDrucksachen } = transport([{ documents: [doc('1')], cursor: 'c1' }]);
    const page = await new DipDataClient(client).enumerate({ since: '2026-08-05' });

    expect(page.origin).toBe('native');
    // A bare date is widened rather than refused; DIP demands a full timestamp.
    expect(searchDrucksachen).toHaveBeenCalledWith(
      expect.objectContaining({ 'f.aktualisiert.start': '2026-08-05T00:00:00+01:00' }),
    );
    expect(page.results[0]).toMatchObject({
      resourceType: 'parliamentary-material',
      jurisdiction: 'DE',
      // Was 'allowed' — downgraded once it emerged that DIP publishes no licence
      // statement and nothing here had ever cited one.
      rights: { redistribution: 'unknown' },
    });
  });

  it('stops when DIP hands back the cursor it was given', async () => {
    // The API signals exhaustion by repeating the cursor. Treating that as
    // "more available" would walk the final page forever.
    const { client } = transport([{ documents: [doc('1')], cursor: 'same' }]);
    const page = await new DipDataClient(client).enumerate({ cursor: 'same' });
    expect(page.nextCursor).toBeUndefined();
  });

  it('does not send rows, which DIP ignores, and does not truncate its page', async () => {
    const { client, searchDrucksachen } = transport([
      { documents: [doc('1'), doc('2'), doc('3')], cursor: 'c1' },
    ]);
    const page = await new DipDataClient(client).enumerate({ limit: 1 });

    // Verified live: rows=5 and rows=20 both returned all 57 matches. Cutting
    // the page here would drop documents 2 and 3, because DIP's cursor already
    // points past them.
    expect(searchDrucksachen).toHaveBeenCalledWith(expect.not.objectContaining({ rows: expect.anything() }));
    expect(page.results).toHaveLength(3);
  });

  it('stops on an empty page even when the cursor moved', async () => {
    const { client } = transport([{ documents: [], cursor: 'c2' }]);
    const page = await new DipDataClient(client).enumerate({ cursor: 'c1' });
    expect(page.nextCursor).toBeUndefined();
  });
});
