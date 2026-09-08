import { describe, expect, it } from 'vitest';
import type { LegislationReference } from '../../src/contracts/legal-resource.js';
import { ArxivDataClient } from '../../src/providers/arxiv/data-client.js';
import { DipDataClient } from '../../src/providers/dip/data-client.js';
import { EulDataClient } from '../../src/providers/eul/data-client.js';
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
