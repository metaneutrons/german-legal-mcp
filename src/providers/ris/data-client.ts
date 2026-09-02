import type {
  CaseLawReference,
  LegalDataProvider,
  LegalResourceDocument,
  LegalSearchPage,
  LegalSearchRequest,
  LegislationReference,
} from '../../contracts/legal-resource.js';
import type {
  LegalTableOfContents,
  TableOfContentsCapability,
} from '../../contracts/provider-capabilities.js';
import { RisClient, type RisNormOptions, type RisSearchOptions } from './client.js';
import { risHtmlToMarkdown } from './converter.js';
import { parseToc } from './toc.js';
import type { RisApplication, RisSearchHit } from './types.js';
import { assertRisDocumentUrl, buildRisDocumentUrl } from './network-policy.js';

export type RisReference = CaseLawReference | LegislationReference;

const RIGHTS = {
  access: 'public',
  fullTextStorage: 'allowed',
  redistribution: 'unknown',
  licence: 'NOASSERTION',
} as const;

const SOURCE_APPLICATION: Record<string, RisApplication> = {
  bundesrecht: 'bundesrecht',
  brkons: 'bundesrecht',
  bgblauth: 'bundesrecht',
  landesrecht: 'landesrecht',
  lrkons: 'landesrecht',
  judikatur: 'judikatur',
  justiz: 'judikatur',
  vwgh: 'judikatur',
  vfgh: 'judikatur',
  bvwg: 'judikatur',
};

/**
 * Judikatur is one upstream endpoint shared by several sub-courts (RisClient
 * passes this as `Applikation`). A requested sourceId like `ris:Bvwg` must
 * resolve to this literal so `search()` actually queries that sub-court
 * instead of silently defaulting to Justiz.
 */
const JUDIKATUR_COURT: Record<string, string> = {
  justiz: 'Justiz',
  vwgh: 'Vwgh',
  vfgh: 'Vfgh',
  bvwg: 'Bvwg',
};

const STATE_JURISDICTION: Record<string, string> = {
  burgenland: 'AT-1',
  kärnten: 'AT-2',
  kaernten: 'AT-2',
  niederösterreich: 'AT-3',
  niederoesterreich: 'AT-3',
  oberösterreich: 'AT-4',
  oberoesterreich: 'AT-4',
  salzburg: 'AT-5',
  steiermark: 'AT-6',
  tirol: 'AT-7',
  vorarlberg: 'AT-8',
  wien: 'AT-9',
};

const JURISDICTION_STATE: Record<string, string> = {
  'AT-1': 'Burgenland',
  'AT-2': 'Kaernten',
  'AT-3': 'Niederoesterreich',
  'AT-4': 'Oberoesterreich',
  'AT-5': 'Salzburg',
  'AT-6': 'Steiermark',
  'AT-7': 'Tirol',
  'AT-8': 'Vorarlberg',
  'AT-9': 'Wien',
};

export class RisDataClient implements
  LegalDataProvider<RisReference>,
  TableOfContentsCapability<LegislationReference> {
  constructor(private readonly transport: RisClient = new RisClient()) {}

  searchRis(application: RisApplication, options: RisSearchOptions) {
    return this.transport.search(application, options);
  }

  getNorm(application: 'bundesrecht' | 'landesrecht', options: RisNormOptions) {
    return this.transport.getNorm(application, options);
  }

  resolveWholeLawUrl(
    application: 'bundesrecht' | 'landesrecht',
    options: { law: string; bundesland?: string | undefined },
  ) {
    return this.transport.resolveWholeLawUrl(application, options);
  }

  fetchHtml(url: string, timeoutMs?: number) {
    return timeoutMs === undefined
      ? this.transport.fetchHtml(url)
      : this.transport.fetchHtml(url, timeoutMs);
  }

  async search(request: LegalSearchRequest): Promise<LegalSearchPage<RisReference>> {
    const applications = selectApplications(request);
    if (applications.length === 0) return { results: [], failures: [] };
    const tasks = buildSearchTasks(applications, request);
    const requestedLimit = request.limit ?? 10;
    const upstreamLimit = Math.max(requestedLimit, 10);
    const settled = await Promise.allSettled(tasks.map(async (task) => ({
      task,
      result: await this.searchRis(task.application, {
        query: request.query,
        limit: upstreamLimit,
        ...(task.application === 'judikatur'
          ? (task.court ? { court: task.court } : {})
          : { consolidatedOnly: true, searchField: 'title' as const }),
      }),
    })));
    const results = settled.flatMap((entry) => entry.status === 'fulfilled'
      ? entry.value.result.hits.map((hit) => toReference(hit, entry.value.task.application))
      : []);
    return {
      results: results
        .sort((left, right) => searchScore(right.title, request.query)
          - searchScore(left.title, request.query))
        .slice(0, requestedLimit),
      failures: settled.flatMap((entry, index) => entry.status === 'rejected'
        ? [{
            sourceId: `ris:${tasks[index]?.court ?? tasks[index]?.application ?? 'unknown'}`,
            message: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
            cause: entry.reason,
          }]
        : []),
    };
  }

  async get(reference: RisReference): Promise<LegalResourceDocument<RisReference>> {
    assertReference(reference);
    const url = directDocumentUrl(
      sourceSegment(reference.provenance.sourceId),
      reference.provenance.providerDocumentId,
    );
    const markdown = risHtmlToMarkdown(await this.fetchHtml(url));
    return {
      reference: {
        ...reference,
        provenance: {
          ...reference.provenance,
          canonicalUrl: reference.provenance.canonicalUrl ?? url,
        },
      } as RisReference,
      content: { format: 'markdown', value: markdown },
    };
  }

  async getTableOfContents(
    reference: LegislationReference,
  ): Promise<LegalTableOfContents<LegislationReference>> {
    assertReference(reference);
    const application = sourceApplication(reference.provenance.sourceId);
    if (application === 'judikatur') {
      throw new Error('RIS case-law documents do not expose a native table of contents.');
    }
    const source = await this.resolveWholeLawUrl(application, {
      law: reference.title,
      ...(reference.jurisdiction && JURISDICTION_STATE[reference.jurisdiction]
        ? { bundesland: JURISDICTION_STATE[reference.jurisdiction] }
        : {}),
    });
    if (!source) throw new Error(`Could not resolve RIS table of contents for "${reference.title}".`);
    const entries = parseToc(await this.fetchHtml(assertRisDocumentUrl(source.url), 90_000));
    return {
      reference,
      origin: 'native',
      entries: entries.map((entry, index) => ({
        id: entry.paragraph || `entry-${index + 1}`,
        title: entry.heading || `§ ${entry.paragraph}`,
        label: `§ ${entry.paragraph}`,
        level: 0,
      })),
    };
  }
}

function searchScore(title: string, query: string): number {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;
  let score = normalizedTitle === normalizedQuery ? 1_000 : 0;
  if (normalizedTitle.includes(normalizedQuery)) score += 500;
  for (const term of normalizedQuery.split(' ').filter((value) => value.length > 1)) {
    if (normalizedTitle.includes(term)) score += 25;
  }
  return score;
}

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('de-AT')
    .replace(/[äöüß]/g, (character) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[character] ?? character)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function selectApplications(request: LegalSearchRequest): RisApplication[] {
  const byType = new Set<RisApplication>();
  if (!request.resourceTypes || request.resourceTypes.includes('legislation')) {
    byType.add('bundesrecht');
    byType.add('landesrecht');
  }
  if (!request.resourceTypes || request.resourceTypes.includes('case-law')) {
    byType.add('judikatur');
  }
  if (request.jurisdictions && !request.jurisdictions.some((value) => value.toUpperCase().startsWith('AT'))) {
    return [];
  }
  if (!request.sourceIds) return [...byType];
  const requested = new Set(request.sourceIds.map(sourceApplication));
  return [...byType].filter((application) => requested.has(application));
}

interface RisSearchTask {
  readonly application: RisApplication;
  readonly court?: string;
}

/**
 * Judikatur is a single upstream endpoint covering several sub-courts, so a
 * request naming specific ones (e.g. `sourceIds: ["ris:Bvwg", "ris:Vwgh"]`)
 * must fan out into one search per requested court rather than one
 * undifferentiated judikatur search (which would silently default to
 * Justiz). Requests with no judikatur-specific sourceId keep today's
 * single-call default behavior.
 */
function buildSearchTasks(applications: RisApplication[], request: LegalSearchRequest): RisSearchTask[] {
  return applications.flatMap((application): RisSearchTask[] => {
    if (application !== 'judikatur') return [{ application }];
    const courts = [...new Set(
      (request.sourceIds ?? [])
        .map(sourceCourt)
        .filter((court): court is string => court !== undefined),
    )];
    return courts.length > 0
      ? courts.map((court) => ({ application, court }))
      : [{ application }];
  });
}

function toReference(hit: RisSearchHit, application: RisApplication): RisReference {
  const sourceId = `ris:${hit.applikation || application}`;
  const canonicalUrl = hit.documentUrl ?? hit.contentUrl;
  const provenance = {
    providerId: 'ris',
    sourceId,
    providerDocumentId: hit.id,
    ...(canonicalUrl ? { canonicalUrl } : {}),
  };
  if (application === 'judikatur') {
    return {
      resourceType: 'case-law',
      title: hit.title,
      jurisdiction: 'AT',
      language: 'de',
      ...(hit.date ? { decisionDate: hit.date } : {}),
      ...(hit.organ ? { court: hit.organ } : {}),
      ...(hit.fileNumber ? { fileNumber: hit.fileNumber } : {}),
      ...(hit.ecli ? { ecli: hit.ecli } : {}),
      provenance,
      rights: RIGHTS,
    };
  }
  return {
    resourceType: 'legislation',
    title: hit.title,
    jurisdiction: hit.bundesland
      ? STATE_JURISDICTION[hit.bundesland.toLocaleLowerCase('de-AT')] ?? 'AT'
      : 'AT',
    language: 'de',
    ...(hit.publicationDate ? { publicationDate: hit.publicationDate } : {}),
    ...(hit.eli ? { eli: hit.eli } : {}),
    ...(hit.validFrom ? { validFrom: hit.validFrom } : {}),
    ...(hit.validTo ? { validTo: hit.validTo } : {}),
    provenance,
    rights: RIGHTS,
  };
}

function sourceApplication(sourceId: string): RisApplication {
  const normalized = sourceSegment(sourceId).toLocaleLowerCase('de-AT');
  return SOURCE_APPLICATION[normalized] ?? 'judikatur';
}

function sourceCourt(sourceId: string): string | undefined {
  const normalized = sourceSegment(sourceId).toLocaleLowerCase('de-AT');
  return JUDIKATUR_COURT[normalized];
}

function sourceSegment(sourceId: string): string {
  return sourceId.startsWith('ris:') ? sourceId.slice(4) : sourceId;
}

function directDocumentUrl(application: string, id: string): string {
  return buildRisDocumentUrl(application, id);
}

function assertReference(reference: RisReference): void {
  if (reference.provenance.providerId !== 'ris') {
    throw new Error(`Reference does not belong to ris: ${reference.provenance.providerId}`);
  }
}
