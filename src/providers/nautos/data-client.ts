import type {
  LegalDataProvider,
  LegalResourceDocument,
  LegalSearchPage,
  LegalSearchRequest,
  TechnicalStandardReference,
} from '../../contracts/legal-resource.js';
import type {
  AuthenticationCapability,
  LegalTableOfContents,
  LegalTableOfContentsEntry,
  ProviderAuthenticationStatus,
  TableOfContentsCapability,
} from '../../contracts/provider-capabilities.js';
import {
  clearNautosAuthentication,
  getNautosAuthenticationSnapshot,
  NautosClient,
  refreshNautosAuthentication,
  type DocumentDetail,
  type SearchResult,
  type TocSection,
} from './client.js';

const RIGHTS = {
  access: 'credentialed',
  fullTextStorage: 'cache-only',
  redistribution: 'prohibited',
  licence: 'LicenseRef-Nautos-Credentialed',
} as const;

export interface NautosAuthenticationAdapter {
  getSnapshot(): { authenticated: boolean; expiresAt?: number };
  refresh(): Promise<{ authenticated: boolean; expiresAt?: number }>;
  clear(): void;
}

const DEFAULT_AUTHENTICATION: NautosAuthenticationAdapter = {
  getSnapshot: getNautosAuthenticationSnapshot,
  refresh: refreshNautosAuthentication,
  clear: clearNautosAuthentication,
};

export class NautosDataClient implements
  LegalDataProvider<TechnicalStandardReference>,
  TableOfContentsCapability<TechnicalStandardReference>,
  AuthenticationCapability {
  constructor(
    private readonly transport: NautosClient = new NautosClient(),
    private readonly authentication: NautosAuthenticationAdapter = DEFAULT_AUTHENTICATION,
  ) {}

  searchStandards(documentNumber: string, pageSize?: number) {
    return this.transport.search(documentNumber, pageSize);
  }

  getDetail(acCode: string) {
    return this.transport.getDetail(acCode);
  }

  getToc(din21Id: string) {
    return this.transport.getToc(din21Id);
  }

  getSection(din21Id: string, sectionId: string) {
    return this.transport.getSection(din21Id, sectionId);
  }

  async search(request: LegalSearchRequest): Promise<LegalSearchPage<TechnicalStandardReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('technical-standard')) {
      return { results: [], failures: [] };
    }
    if (request.sourceIds && !request.sourceIds.includes('nautos')) {
      return { results: [], failures: [] };
    }
    const { items } = await this.searchStandards(request.query, request.limit ?? 10);
    return { results: items.map(toSearchReference), failures: [] };
  }

  async get(reference: TechnicalStandardReference): Promise<LegalResourceDocument<TechnicalStandardReference>> {
    assertReference(reference);
    const detail = await this.getDetail(reference.provenance.providerDocumentId);
    return {
      reference: toDetailReference(detail),
      content: {
        format: 'text',
        value: [
          detail.titleDe,
          detail.titleEn,
          `Ausgabedatum: ${detail.dateOfIssue}`,
          `Gültig: ${detail.valid ? 'ja' : 'nein'}`,
          `Dokumenttyp: ${detail.documentType.join(', ')}`,
          `ICS: ${detail.classificationIcs.join(', ')}`,
        ].filter(Boolean).join('\n'),
      },
    };
  }

  async getTableOfContents(
    reference: TechnicalStandardReference,
  ): Promise<LegalTableOfContents<TechnicalStandardReference>> {
    assertReference(reference);
    const detail = await this.getDetail(reference.provenance.providerDocumentId);
    if (!detail.din21Id) {
      throw new Error(`No full text is available for ${detail.documentNumber}.`);
    }
    return {
      reference: toDetailReference(detail),
      origin: 'native',
      entries: mapToc(await this.getToc(detail.din21Id)),
    };
  }

  async getAuthenticationStatus(): Promise<ProviderAuthenticationStatus> {
    return authenticationStatus(this.authentication.getSnapshot());
  }

  async refreshAuthentication(): Promise<ProviderAuthenticationStatus> {
    return authenticationStatus(await this.authentication.refresh());
  }

  async logout(): Promise<void> {
    this.authentication.clear();
  }
}

function mapToc(sections: readonly TocSection[], level = 0): LegalTableOfContentsEntry[] {
  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    ...(section.label ? { label: section.label } : {}),
    level,
    ...(section.section?.length
      ? { children: mapToc(section.section, level + 1) }
      : {}),
  }));
}

function authenticationStatus(
  snapshot: { authenticated: boolean; expiresAt?: number },
): ProviderAuthenticationStatus {
  return {
    state: snapshot.authenticated ? 'authenticated' : 'unauthenticated',
    method: 'credentials',
    ...(snapshot.expiresAt
      ? { expiresAt: new Date(snapshot.expiresAt * 1000).toISOString() }
      : {}),
  };
}

function toSearchReference(result: SearchResult): TechnicalStandardReference {
  return {
    resourceType: 'technical-standard',
    title: result.title,
    language: 'de',
    publicationDate: result.dateOfIssue,
    documentNumber: result.documentNumber,
    standardBodies: result.documentType,
    provenance: {
      providerId: 'nautos',
      sourceId: 'nautos',
      providerDocumentId: result.acCode,
    },
    rights: RIGHTS,
  };
}

function toDetailReference(detail: DocumentDetail): TechnicalStandardReference {
  return {
    resourceType: 'technical-standard',
    title: detail.titleDe || detail.titleEn || detail.documentNumber,
    language: detail.titleDe ? 'de' : 'en',
    publicationDate: detail.dateOfIssue,
    documentNumber: detail.documentNumber,
    standardBodies: detail.documentType,
    valid: detail.valid,
    provenance: {
      providerId: 'nautos',
      sourceId: 'nautos',
      providerDocumentId: detail.acCode,
    },
    rights: RIGHTS,
  };
}

function assertReference(reference: TechnicalStandardReference): void {
  if (reference.provenance.providerId !== 'nautos') {
    throw new Error(`Reference does not belong to nautos: ${reference.provenance.providerId}`);
  }
}
