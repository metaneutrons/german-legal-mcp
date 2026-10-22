import axios, { type AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import type { CaseLawReference, LegislationReference } from '../../src/contracts/legal-resource.js';
import { ArxivDataClient } from '../../src/providers/arxiv/data-client.js';
import { DipDataClient } from '../../src/providers/dip/data-client.js';
import { EulDataClient } from '../../src/providers/eul/data-client.js';
import { extractSection } from '../../src/providers/eul/provider.js';
import { IcuDataClient } from '../../src/providers/icu/data-client.js';
import { RisDataClient } from '../../src/providers/ris/data-client.js';
import {
  liveEnabled,
  tolerateUpstreamRefusal,
  verifySearchAndGet,
  verifyTableOfContents,
} from './contract-assertions.js';

const LIVE = liveEnabled('GLMCP_LIVE_PUBLIC');

describe.skipIf(!LIVE)('Public provider clients against live sources', () => {
  it('arXiv: search → normalized literature → document', async () => {
    // arXiv throttles cloud IP ranges, so a scheduled runner can be refused
    // outright while the same request succeeds elsewhere.
    await tolerateUpstreamRefusal('arXiv', async () => {
      const { reference } = await verifySearchAndGet(new ArxivDataClient(), {
        query: 'privacy law',
        resourceTypes: ['literature'],
        sourceIds: ['arxiv'],
        limit: 1,
      }, {
        providerId: 'arxiv',
        sourceId: 'arxiv',
        resourceType: 'literature',
        minimumContentLength: 80,
      });
      expect(reference.resourceType).toBe('literature');
      expect(reference.authors?.length ?? 0).toBeGreaterThan(0);
    });
  });

  it('DIP: search → normalized parliamentary material → document', async () => {
    const { reference } = await verifySearchAndGet(new DipDataClient(), {
      query: 'Datenschutz',
      resourceTypes: ['parliamentary-material'],
      jurisdictions: ['DE'],
      sourceIds: ['dip:bundestag'],
      limit: 1,
    }, {
      providerId: 'dip',
      sourceId: 'dip:bundestag',
      resourceType: 'parliamentary-material',
      jurisdiction: 'DE',
      minimumContentLength: 30,
    });
    expect(reference.resourceType).toBe('parliamentary-material');
    expect(reference.documentNumber?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it('EU Cellar: search → normalized legislation → document', async () => {
    const { reference } = await verifySearchAndGet(new EulDataClient(), {
      query: 'personenbezogener Daten',
      resourceTypes: ['legislation'],
      jurisdictions: ['EU'],
      sourceIds: ['eul:cellar'],
      limit: 1,
    }, {
      providerId: 'eul',
      sourceId: 'eul:cellar',
      resourceType: 'legislation',
      jurisdiction: 'EU',
      minimumContentLength: 100,
    });
    expect(reference.resourceType).toBe('legislation');
    expect(reference.celex?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it('EU Cellar: Official Journal text with annexes, never a bot challenge', async () => {
    const text = await new EulDataClient().getLegislationText('32024R1689', 'DE');
    expect(text.version).toBe('official-journal');
    expect(text.markdown).not.toContain('awsWaf');
    expect(extractSection(text.markdown, 'Art. 4')).toContain('KI-Kompetenz');
    const annex = extractSection(text.markdown, 'Anhang III') ?? '';
    expect(annex).toMatch(/^# ANHANG\sIII/u);
    expect(annex).toContain('Biometrie');
    expect(annex).not.toMatch(/ANHANG\sIV/u);
  });

  it('EU Cellar: bare consolidated CELEX resolves to a dated consolidated version', async () => {
    const text = await new EulDataClient().getLegislationText('02016R0679', 'DE');
    expect(text.version).toBe('consolidated');
    expect(text.celex).toMatch(/^02016R0679-\d{8}$/);
    expect(extractSection(text.markdown, 'Artikel 6')).toContain('Rechtmäßigkeit');
  });

  it('InfoCuria: search → normalized case law → document', async () => {
    const { reference } = await verifySearchAndGet(new IcuDataClient(), {
      query: 'C-311/18',
      resourceTypes: ['case-law'],
      jurisdictions: ['EU'],
      sourceIds: ['icu:infocuria'],
      limit: 1,
    }, {
      providerId: 'icu',
      sourceId: 'icu:infocuria',
      resourceType: 'case-law',
      jurisdiction: 'EU',
      minimumContentLength: 100,
    });
    expect(reference.resourceType).toBe('case-law');
    expect(
      Boolean(reference.fileNumber?.trim()) || Boolean(reference.ecli?.trim()),
    ).toBe(true);
  });

  it('InfoCuria: a CELEX reference is served from Cellar, not EUR-Lex or InfoCuria', async () => {
    const http = { get: vi.fn(axios.get), post: vi.fn(axios.post) };
    const reference = {
      resourceType: 'case-law',
      title: 'Facebook Ireland und Schrems',
      language: 'de',
      provenance: { providerId: 'icu', sourceId: 'icu:infocuria', providerDocumentId: '62018CJ0311' },
      rights: { access: 'public', fullTextStorage: 'allowed', redistribution: 'unknown' },
    } as CaseLawReference;
    const document = await new IcuDataClient(http as unknown as Pick<AxiosInstance, 'get' | 'post'>).get(reference);
    expect(document.reference.language).toBe('de');
    expect(document.content.value).toContain('Facebook Ireland');
    expect(http.post).not.toHaveBeenCalled();
    expect(http.get.mock.calls.every(([url]) => String(url).startsWith('https://publications.europa.eu/'))).toBe(true);
  });

  it('RIS Judikatur: search → normalized case law → document', async () => {
    const { reference } = await verifySearchAndGet(new RisDataClient(), {
      query: 'Datenschutz',
      resourceTypes: ['case-law'],
      jurisdictions: ['AT'],
      sourceIds: ['ris:judikatur'],
      limit: 1,
    }, {
      providerId: 'ris',
      resourceType: 'case-law',
      jurisdiction: 'AT',
      minimumContentLength: 80,
    });
    expect(reference.provenance.sourceId).toMatch(/^ris:/);
    expect(reference.resourceType).toBe('case-law');
    if (reference.resourceType !== 'case-law') {
      throw new Error(`Expected RIS case law, received ${reference.resourceType}`);
    }
    expect(
      Boolean(reference.court?.trim())
        || Boolean(reference.fileNumber?.trim())
        || Boolean(reference.ecli?.trim()),
    ).toBe(true);
  });

  it('RIS Bundesrecht: search → normalized legislation → document → TOC', async () => {
    const client = new RisDataClient();
    const { reference } = await verifySearchAndGet(client, {
      query: 'Datenschutzgesetz',
      resourceTypes: ['legislation'],
      jurisdictions: ['AT'],
      sourceIds: ['ris:bundesrecht'],
      limit: 1,
    }, {
      providerId: 'ris',
      resourceType: 'legislation',
      jurisdiction: 'AT',
      minimumContentLength: 80,
    });
    expect(reference.provenance.sourceId).toMatch(/^ris:/);
    verifyTableOfContents(
      await client.getTableOfContents(reference as LegislationReference),
    );
  });
});
