import { describe, expect, it, vi } from 'vitest';
import type { DipClient, DipDocument, DipSearchResult } from './client.js';
import { DipProvider } from './provider.js';

const document: DipDocument = {
  id: '1',
  dokumentnummer: '20/1',
  titel: 'Gesetzentwurf',
  datum: '2025-01-01',
  drucksachetyp: 'Gesetzentwurf',
  herausgeber: 'BT',
  text: '# Begründung\nText',
  fundstelle: { pdf_url: 'https://example.test/doc.pdf' },
  urheber: [{ bezeichnung: 'Fraktion', titel: 'Test' }],
  ressort: [{ federfuehrend: true, titel: 'BMJ' }],
  vorgangsbezug: [{ id: 'v1', titel: 'Vorgang', vorgangstyp: 'Gesetzgebung' }],
  vorgangstyp: 'Gesetzgebung',
  beratungsstand: 'Abgeschlossen',
  wahlperiode: 20,
  deskriptor: [{ name: 'Recht', typ: 'Sachbegriffe' }],
};

function result(documents = [document]): DipSearchResult {
  return { numFound: documents.length, documents, cursor: '' };
}

function fakeClient() {
  return {
    searchDrucksachen: vi.fn(async () => result()),
    searchDrucksachenText: vi.fn(async () => result()),
    searchVorgang: vi.fn(async () => result()),
    searchPlenarprotokollText: vi.fn(async () => result()),
  } as unknown as DipClient;
}

describe('DipProvider', () => {
  it('routes and formats every DIP use case', async () => {
    const provider = new DipProvider(fakeClient());
    for (const [tool, args, expected] of [
      ['dip_search', { query: 'Recht' }, 'Gesetzentwurf'],
      ['dip_get', { dokumentnummer: '20/1', section: 'Begründung' }, 'Begründung'],
      ['dip_search_vorgang', { query: 'Recht' }, 'Vorgänge'],
      ['dip_search_plenarprotokoll', { query: 'Recht' }, 'Protokolle'],
    ] as const) {
      await expect(provider.handleToolCall(tool, args)).resolves.toMatchObject({
        content: [{ text: expect.stringContaining(expected) }],
      });
    }
  });

  it('reports missing and unknown documents', async () => {
    const client = fakeClient();
    client.searchDrucksachenText = vi.fn(async () => result([]));
    const provider = new DipProvider(client);
    await expect(provider.handleToolCall('dip_get', {
      dokumentnummer: 'missing',
    })).resolves.toMatchObject({ isError: true });
    await expect(provider.handleToolCall('dip_unknown', {}))
      .resolves.toMatchObject({ isError: true });
  });
});
