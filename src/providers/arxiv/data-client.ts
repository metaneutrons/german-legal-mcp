import type {
  LegalDataProvider,
  LegalResourceDocument,
  LegalSearchPage,
  LegalSearchRequest,
  LiteratureReference,
} from '../../contracts/legal-resource.js';
import { ArxivClient, type ArxivEntry } from './client.js';
import { htmlToMarkdown } from './converter.js';

const RIGHTS = {
  access: 'public',
  fullTextStorage: 'unknown',
  redistribution: 'metadata-only',
  licence: 'NOASSERTION',
} as const;

export class ArxivDataClient implements LegalDataProvider<LiteratureReference> {
  constructor(private readonly transport: ArxivClient = new ArxivClient()) {}

  searchEntries(params: Record<string, string | number>) {
    return this.transport.search(params);
  }

  getHtml(arxivId: string) {
    return this.transport.getHtml(arxivId);
  }

  async getEntry(arxivId: string): Promise<ArxivEntry | null> {
    const { entries } = await this.searchEntries({ id_list: arxivId, max_results: 1 });
    return entries[0] ?? null;
  }

  async search(request: LegalSearchRequest): Promise<LegalSearchPage<LiteratureReference>> {
    if (request.resourceTypes && !request.resourceTypes.includes('literature')) {
      return { results: [], failures: [] };
    }
    if (request.sourceIds && !request.sourceIds.some((id) => id === 'arxiv')) {
      return { results: [], failures: [] };
    }
    const { entries } = await this.searchEntries({
      search_query: request.query,
      max_results: request.limit ?? 10,
      ...(request.cursor ? { start: Number.parseInt(request.cursor, 10) || 0 } : {}),
    });
    return { results: entries.map(toReference), failures: [] };
  }

  async get(reference: LiteratureReference): Promise<LegalResourceDocument<LiteratureReference>> {
    assertReference(reference);
    const entry = await this.getEntry(reference.provenance.providerDocumentId);
    if (!entry) throw new Error(`arXiv paper ${reference.provenance.providerDocumentId} not found.`);
    const html = await this.getHtml(entry.id);
    return {
      reference: toReference(entry),
      content: {
        format: 'markdown',
        value: html ? htmlToMarkdown(html) : `## Abstract\n\n${entry.summary}`,
      },
    };
  }
}

function toReference(entry: ArxivEntry): LiteratureReference {
  return {
    resourceType: 'literature',
    title: entry.title,
    language: 'en',
    publicationDate: entry.published,
    authors: entry.authors,
    ...(entry.journalRef ? { journal: entry.journalRef } : {}),
    ...(entry.doi ? { doi: entry.doi } : {}),
    provenance: {
      providerId: 'arxiv',
      sourceId: 'arxiv',
      providerDocumentId: entry.id,
      canonicalUrl: `https://arxiv.org/abs/${entry.id}`,
    },
    rights: RIGHTS,
  };
}

function assertReference(reference: LiteratureReference): void {
  if (reference.provenance.providerId !== 'arxiv') {
    throw new Error(`Reference does not belong to arxiv: ${reference.provenance.providerId}`);
  }
}
