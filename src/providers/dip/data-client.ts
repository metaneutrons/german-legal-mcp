import type {
  LegalDataProvider,
  LegalResourceDocument,
  LegalSearchPage,
  LegalSearchRequest,
  ParliamentaryMaterialReference,
} from '../../contracts/legal-resource.js';
import type {
  CorpusEnumerationCapability,
  CorpusEnumerationPage,
  CorpusEnumerationRequest,
} from '../../contracts/provider-capabilities.js';
import { DipClient, type DipDocument } from './client.js';

const RIGHTS = {
  access: 'public',
  fullTextStorage: 'allowed',
  // Downgraded from 'allowed' 2026-08-08. That grant had no recorded basis:
  // DIP publishes no licence statement on its API help or Swagger pages, and
  // none was cited here. Bundestag Drucksachen are very likely amtliche Werke
  // under § 5 UrhG — so the *texts* are probably free — but the portal's terms
  // and the database right in its compilation are unassessed, exactly as for
  // `legis` and `rii`. 'unknown' is what we actually know.
  redistribution: 'unknown',
  licence: 'NOASSERTION',
} as const;

export class DipDataClient
implements LegalDataProvider<ParliamentaryMaterialReference>,
  CorpusEnumerationCapability<ParliamentaryMaterialReference> {
  constructor(private readonly transport: DipClient = new DipClient()) {}

  searchDrucksachen(params: Record<string, string | number>) {
    return this.transport.searchDrucksachen(params);
  }

  searchDrucksachenText(params: Record<string, string | number>) {
    return this.transport.searchDrucksachenText(params);
  }

  searchVorgang(params: Record<string, string | number>) {
    return this.transport.searchVorgang(params);
  }

  searchPlenarprotokollText(params: Record<string, string | number>) {
    return this.transport.searchPlenarprotokollText(params);
  }

  getDrucksache(id: string) {
    return this.transport.getDrucksache(id);
  }

  /**
   * Walk the Drucksachen archive by last-modified date.
   *
   * `origin` is `native`: DIP is a real API, filters on `f.aktualisiert.start`
   * server-side and pages with its own cursor, so a delta run transfers only
   * the delta. It is also the one source in this package whose rights allow
   * redistribution, which makes it the only corpus that can be served in full
   * rather than as metadata and a link.
   *
   * `limit` is advisory here and deliberately not enforced. DIP fixes its own
   * page size — `rows` was verified to change nothing at 5 or 20, both
   * returning all 57 matches — and its cursor is opaque and page-scoped, so
   * truncating a page client-side would silently drop the documents between
   * the cut and the cursor on the next call.
   */
  async enumerate(
    request: CorpusEnumerationRequest = {},
  ): Promise<CorpusEnumerationPage<ParliamentaryMaterialReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('parliamentary-material')) {
      return { results: [], failures: [], origin: 'native' };
    }
    if (request.jurisdictions && !request.jurisdictions.some((id) => id.toUpperCase() === 'DE')) {
      return { results: [], failures: [], origin: 'native' };
    }
    const response = await this.searchDrucksachen({
      ...(request.since ? { 'f.aktualisiert.start': toDipTimestamp(request.since) } : {}),
      ...(request.cursor ? { cursor: request.cursor } : {}),
    });

    // DIP signals exhaustion by handing back the cursor it was given. Treating
    // that as "there is more" would loop over the final page forever, so the
    // walk ends when the cursor stops moving or the page comes back empty.
    const cursorMoved = !!response.cursor && response.cursor !== request.cursor;
    const hasMore = cursorMoved && response.documents.length > 0;

    return {
      results: response.documents.map(toReference),
      failures: [],
      ...(hasMore ? { nextCursor: response.cursor } : {}),
      origin: 'native',
    };
  }

  async search(request: LegalSearchRequest): Promise<LegalSearchPage<ParliamentaryMaterialReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('parliamentary-material')) {
      return { results: [], failures: [] };
    }
    if (request.jurisdictions && !request.jurisdictions.some((id) => id.toUpperCase() === 'DE')) {
      return { results: [], failures: [] };
    }
    if (request.sourceIds && !request.sourceIds.includes('dip:bundestag')) {
      return { results: [], failures: [] };
    }
    const response = await this.searchDrucksachen({
      'f.titel': request.query,
      rows: request.limit ?? 10,
      ...(request.cursor ? { cursor: request.cursor } : {}),
    });
    return {
      results: response.documents.map(toReference),
      failures: [],
      ...(response.cursor ? { nextCursor: response.cursor } : {}),
    };
  }

  async get(reference: ParliamentaryMaterialReference): Promise<LegalResourceDocument<ParliamentaryMaterialReference>> {
    assertReference(reference);
    const document = await this.getDrucksache(reference.provenance.providerDocumentId);
    if (!document) throw new Error(`DIP document ${reference.provenance.providerDocumentId} not found.`);
    return {
      reference: toReference(document),
      content: {
        format: 'text',
        value: document.text ?? document.titel,
      },
    };
  }
}

/**
 * DIP rejects a bare date on `f.aktualisiert.start` — it wants a full
 * timestamp with an offset. A date-only bound is widened to the start of that
 * day rather than refused, so callers can pass the same `since` they give
 * every other provider.
 */
function toDipTimestamp(since: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00+01:00` : since;
}

function toReference(document: DipDocument): ParliamentaryMaterialReference {
  return {
    resourceType: 'parliamentary-material',
    title: document.titel.replace(/\r?\n/g, ' ').trim(),
    jurisdiction: 'DE',
    language: 'de',
    publicationDate: document.datum,
    ...(document.dokumentnummer ? { documentNumber: document.dokumentnummer } : {}),
    ...(document.wahlperiode ? { legislativePeriod: document.wahlperiode } : {}),
    ...(document.herausgeber ? { issuer: document.herausgeber } : {}),
    provenance: {
      providerId: 'dip',
      sourceId: 'dip:bundestag',
      providerDocumentId: document.id,
      ...(document.fundstelle?.pdf_url ? { canonicalUrl: document.fundstelle.pdf_url } : {}),
    },
    rights: RIGHTS,
  };
}

function assertReference(reference: ParliamentaryMaterialReference): void {
  if (reference.provenance.providerId !== 'dip') {
    throw new Error(`Reference does not belong to dip: ${reference.provenance.providerId}`);
  }
}
