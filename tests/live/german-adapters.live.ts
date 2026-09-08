import { afterAll, describe, expect, it } from 'vitest';
import type { LegislationReference } from '../../src/contracts/legal-resource.js';
import {
  CaseLawClient,
  createGermanDecisionAdapters,
} from '../../src/providers/rii/client.js';
import {
  LegislationClient,
  PUBLIC_LEGISLATION_RIGHTS,
  createGermanLegislationAdapters,
} from '../../src/providers/legis/client.js';
import {
  liveEnabled,
  reportLiveContract,
  verifyDocument,
  verifySearchAndGet,
  verifyTableOfContents,
} from './contract-assertions.js';

const LIVE = liveEnabled('GLMCP_LIVE_PUBLIC');
const caseLaw = new CaseLawClient(createGermanDecisionAdapters());
const legislation = new LegislationClient(createGermanLegislationAdapters());

const CASE_LAW_QUERIES: Readonly<Record<string, string>> = {
  HB: '',
  SN: '',
};

const LEGISLATION_QUERIES: Readonly<Record<string, string>> = {
  BB: 'Datenschutzgesetz',
  HB: 'Datenschutzgesetz',
  SN: 'Datenschutzgesetz',
};

afterAll(() => {
  caseLaw.shutdown();
  legislation.shutdown();
});

describe.skipIf(!LIVE)('German case-law adapters against live sources', () => {
  for (const source of caseLaw.sources) {
    it(`${source}: search → normalized reference → document`, async () => {
      const { reference, document } = await verifySearchAndGet(caseLaw, {
        query: CASE_LAW_QUERIES[source] ?? 'Datenschutz',
        sourceIds: [`de-case-law:${source}`],
        resourceTypes: ['case-law'],
        limit: 1,
      }, {
        providerId: 'de-case-law',
        sourceId: `de-case-law:${source}`,
        resourceType: 'case-law',
        jurisdiction: source === 'BUND' ? 'DE' : `DE-${source}`,
        minimumContentLength: 80,
      });

      expect(reference.resourceType).toBe('case-law');
      expect(document.reference.resourceType).toBe('case-law');
      expect(
        Boolean(document.reference.court?.trim())
          || Boolean(document.reference.fileNumber?.trim())
          || Boolean(document.reference.ecli?.trim()),
        `${source} returned no court, file number or ECLI`,
      ).toBe(true);
      expect(document.content.value, `${source} returned a search portal instead of a decision`)
        .not.toMatch(/Entscheidungsfindung\s*-\s*Suche|Neueste Entscheidungen/i);
    });
  }
});

describe.skipIf(!LIVE)('German legislation adapters against live sources', () => {
  for (const source of legislation.searchableSources) {
    it(`${source}: search → normalized reference → document → TOC`, async () => {
      const expected = {
        providerId: 'de-legislation',
        sourceId: `de-legislation:${source}`,
        resourceType: 'legislation' as const,
        jurisdiction: `DE-${source}`,
        minimumContentLength: 80,
      };
      const { reference } = await verifySearchAndGet(legislation, {
        query: LEGISLATION_QUERIES[source] ?? 'Datenschutz',
        sourceIds: [`de-legislation:${source}`],
        resourceTypes: ['legislation'],
        limit: 1,
      }, expected);

      verifyTableOfContents(await legislation.getTableOfContents(reference));
    });
  }

  it('BUND: direct section retrieval and native law TOC', async () => {
    const sectionReference = federalReference('bgb/823', 'BGB § 823');
    const document = await legislation.get(sectionReference);
    verifyDocument(document, {
      providerId: 'de-legislation',
      sourceId: 'de-legislation:BUND',
      resourceType: 'legislation',
      jurisdiction: 'DE',
      minimumContentLength: 80,
    });
    reportLiveContract('de-legislation', 'de-legislation:BUND', {
      resourceType: 'legislation',
      documentId: document.reference.provenance.providerDocumentId,
      title: document.reference.title,
      contentLength: document.content.value.length,
    });

    verifyTableOfContents(
      await legislation.getTableOfContents(federalReference('bgb', 'Bürgerliches Gesetzbuch')),
    );
  });
});

function federalReference(id: string, title: string): LegislationReference {
  return {
    resourceType: 'legislation',
    title,
    jurisdiction: 'DE',
    language: 'de',
    provenance: {
      providerId: 'de-legislation',
      sourceId: 'de-legislation:BUND',
      providerDocumentId: id,
    },
    rights: PUBLIC_LEGISLATION_RIGHTS,
  };
}
