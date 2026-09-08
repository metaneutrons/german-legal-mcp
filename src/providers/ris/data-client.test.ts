import { describe, expect, it, vi } from 'vitest';
import type { LegislationReference } from '../../contracts/legal-resource.js';
import type { RisClient } from './client.js';
import { RisDataClient } from './data-client.js';
import type { RisApplication, RisSearchHit } from './types.js';

const caseHit: RisSearchHit = {
  id: 'CASE1',
  applikation: 'Justiz',
  title: 'OGH zum Datenschutz',
  organ: 'OGH',
  date: '2026-01-01',
  fileNumber: '6 Ob 1/26',
  ecli: 'ECLI:AT:OGH:2026:1',
};

const federalHit: RisSearchHit = {
  id: 'LAW1',
  applikation: 'BrKons',
  title: 'Datenschutzgesetz',
  eli: 'eli/bgbl/1978/565/P1/NOR1',
  validFrom: '2026-01-01',
  publicationDate: '2025-12-01',
};

const stateHit: RisSearchHit = {
  id: 'LAW2',
  applikation: 'LrKons',
  title: 'Wiener Datenschutzgesetz',
  bundesland: 'Wien',
  validFrom: '2025-01-01',
};

function client(failing?: RisApplication): RisClient {
  return {
    search: vi.fn(async (application: RisApplication) => {
      if (application === failing) throw new Error(`${application} unavailable`);
      const hits = application === 'judikatur'
        ? [caseHit]
        : application === 'bundesrecht'
          ? [federalHit]
          : [stateHit];
      return { total: hits.length, page: 1, hits };
    }),
    getNorm: vi.fn(async () => ({ total: 1, page: 1, hits: [federalHit] })),
    resolveWholeLawUrl: vi.fn(async () => ({
      title: 'Law',
      url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Landesnormen&Gesetzesnummer=1',
    })),
    fetchHtml: vi.fn(async (url: string) => url.includes('/GeltendeFassung.wxe')
      ? '<p class="InhaltEintrag">§ 1.</p><p class="InhaltEintrag">Zweck.</p>'
      : '<div class="documentContent"><p>Dokument mit genügend Inhalt für den Test.</p></div>'),
  } as unknown as RisClient;
}

describe('RisDataClient', () => {
  it('returns a discriminated union for case law and federal/state legislation', async () => {
    const data = new RisDataClient(client());
    const page = await data.search({ query: 'Datenschutz', limit: 10 });
    expect(page.results).toHaveLength(3);
    expect(page.results.find((result) => result.resourceType === 'case-law')).toMatchObject({
      court: 'OGH',
      fileNumber: '6 Ob 1/26',
      ecli: 'ECLI:AT:OGH:2026:1',
    });
    expect(page.results.find((result) => result.provenance.providerDocumentId === 'LAW1'))
      .toMatchObject({ resourceType: 'legislation', jurisdiction: 'AT', validFrom: '2026-01-01' });
    expect(page.results.find((result) => result.provenance.providerDocumentId === 'LAW2'))
      .toMatchObject({ resourceType: 'legislation', jurisdiction: 'AT-9' });
  });

  it('supports resource/source/jurisdiction filters and partial failures', async () => {
    const transport = client('landesrecht');
    const data = new RisDataClient(transport);
    const page = await data.search({
      query: 'x',
      resourceTypes: ['legislation'],
      sourceIds: ['ris:bundesrecht', 'ris:landesrecht'],
    });
    expect(page.results).toHaveLength(1);
    expect(page.failures[0]).toMatchObject({
      sourceId: 'ris:landesrecht',
      message: 'landesrecht unavailable',
    });
    await expect(data.search({ query: 'x', jurisdictions: ['DE'] }))
      .resolves.toEqual({ results: [], failures: [] });
    await expect(data.search({ query: 'x', resourceTypes: ['literature'] }))
      .resolves.toEqual({ results: [], failures: [] });
  });

  it('threads a requested judikatur sub-court through to the transport', async () => {
    const transport = client();
    const data = new RisDataClient(transport);
    await data.search({ query: 'x', resourceTypes: ['case-law'], sourceIds: ['ris:Bvwg'] });
    expect(transport.search).toHaveBeenCalledWith('judikatur', {
      query: 'x',
      limit: 10,
      court: 'Bvwg',
    });
  });

  it('fans out into one search per distinct requested judikatur sub-court', async () => {
    const transport = client();
    const data = new RisDataClient(transport);
    await data.search({
      query: 'x',
      resourceTypes: ['case-law'],
      sourceIds: ['ris:Bvwg', 'ris:Vwgh'],
    });
    expect(transport.search).toHaveBeenCalledWith('judikatur', expect.objectContaining({ court: 'Bvwg' }));
    expect(transport.search).toHaveBeenCalledWith('judikatur', expect.objectContaining({ court: 'Vwgh' }));
    expect(transport.search).toHaveBeenCalledTimes(2);
  });

  it('keeps the default judikatur search when no sub-court is requested', async () => {
    const transport = client();
    const data = new RisDataClient(transport);
    await data.search({ query: 'x', resourceTypes: ['case-law'] });
    expect(transport.search).toHaveBeenCalledWith('judikatur', { query: 'x', limit: 10 });
  });

  it('reports the specific court in failures when a judikatur sub-court search fails', async () => {
    const transport = client();
    transport.search = vi.fn(async (_application: RisApplication, opts: { court?: string }) => {
      if (opts?.court === 'Vfgh') throw new Error('Vfgh unavailable');
      return { total: 1, page: 1, hits: [caseHit] };
    });
    const data = new RisDataClient(transport);
    const page = await data.search({
      query: 'x',
      resourceTypes: ['case-law'],
      sourceIds: ['ris:Bvwg', 'ris:Vfgh'],
    });
    expect(page.failures).toEqual([
      expect.objectContaining({ sourceId: 'ris:Vfgh', message: 'Vfgh unavailable' }),
    ]);
  });

  it('fetches a stable candidate window and ranks exact law titles locally', async () => {
    const transport = client();
    transport.search = vi.fn(async () => ({
      total: 2,
      page: 1,
      hits: [
        { ...federalHit, id: 'UNRELATED', title: 'Nachhaltigkeitsberichtsgesetz' },
        federalHit,
      ],
    }));
    const data = new RisDataClient(transport);

    const page = await data.search({
      query: 'Datenschutzgesetz',
      resourceTypes: ['legislation'],
      sourceIds: ['ris:bundesrecht'],
      limit: 1,
    });

    expect(transport.search).toHaveBeenCalledWith('bundesrecht', {
      query: 'Datenschutzgesetz',
      limit: 10,
      consolidatedOnly: true,
      searchField: 'title',
    });
    expect(page.results).toHaveLength(1);
    expect(page.results[0]?.provenance.providerDocumentId).toBe('LAW1');
  });

  it('retrieves documents and native legislation TOCs', async () => {
    const transport = client();
    const data = new RisDataClient(transport);
    const page = await data.search({ query: 'x', resourceTypes: ['legislation'] });
    const federal = page.results.find((result) => result.provenance.providerDocumentId === 'LAW1')!;
    expect((await data.get(federal)).content.value).toContain('Dokument');
    expect(transport.fetchHtml).toHaveBeenCalledWith(
      'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/LAW1/LAW1.html',
    );
    const state = page.results.find((result) => result.provenance.providerDocumentId === 'LAW2') as LegislationReference;
    const toc = await data.getTableOfContents(state);
    expect(toc).toMatchObject({
      origin: 'native',
      entries: [{ id: '1', title: 'Zweck', label: '§ 1' }],
    });
    expect(transport.resolveWholeLawUrl).toHaveBeenCalledWith(
      'landesrecht',
      { law: 'Wiener Datenschutzgesetz', bundesland: 'Wien' },
    );
  });

  it('validates ownership and unresolved TOCs', async () => {
    const transport = client();
    transport.resolveWholeLawUrl = vi.fn(async () => null);
    const data = new RisDataClient(transport);
    const reference = {
      resourceType: 'legislation',
      title: 'Unknown',
      jurisdiction: 'AT',
      provenance: { providerId: 'ris', sourceId: 'ris:BrKons', providerDocumentId: 'X' },
      rights: { access: 'public', fullTextStorage: 'allowed', redistribution: 'unknown' },
    } as LegislationReference;
    await expect(data.getTableOfContents(reference)).rejects.toThrow('Could not resolve');
    await expect(data.get({
      ...reference,
      provenance: { ...reference.provenance, providerId: 'other' },
    })).rejects.toThrow('does not belong');
  });
});
