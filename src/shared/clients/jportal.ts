import axios from 'axios';
import { rootLogger } from '../logger.js';
import { safeAxiosPost, type NetworkPolicy } from '../network-policy.js';

const logger = rootLogger.child({ module: 'jportal-client' });

export interface JPortalConfig {
  portalId: string;
  domain: string;
}

interface JPortalSession {
  jsessionId: string;
  csrfToken: string;
  portalId: string;
  domain: string;
}

export interface JPortalSearchResult {
  docId: string;
  title: string;
  subtitle: string;
  category: string;
  date: string;
  docPart: string;
  snippet?: string;
  /** Decision hits only: see `decisionResult` for where these come from. */
  court?: string;
  fileNumber?: string;
}

export interface JPortalDocument {
  title: string;
  head: string;
  text: string;
  permalink: string;
}

interface JPortalInitResponse {
  csrfToken?: string;
  user?: { login?: unknown };
}

interface JPortalSearchResponse {
  resultList?: Array<Record<string, unknown>>;
  hits?: unknown;
}

interface JPortalDocumentResponse {
  documentTitle?: { title?: string };
  head?: string;
  text?: string;
  permalink?: string;
}

const PORTALS: Record<string, JPortalConfig> = {
  BW: { portalId: 'bsbw', domain: 'www.landesrecht-bw.de' },
  BE: { portalId: 'bsbe', domain: 'gesetze.berlin.de' },
  HH: { portalId: 'bsha', domain: 'www.landesrecht-hamburg.de' },
  MV: { portalId: 'bsmv', domain: 'www.landesrecht-mv.de' },
  RP: { portalId: 'bsrp', domain: 'landesrecht.rlp.de' },
  SL: { portalId: 'bssl', domain: 'recht.saarland.de' },
  ST: { portalId: 'bsst', domain: 'www.landesrecht.sachsen-anhalt.de' },
  SH: { portalId: 'bssh', domain: 'www.gesetze-rechtsprechung.sh.juris.de' },
  TH: { portalId: 'bsth', domain: 'landesrecht.thueringen.de' },
  HE: { portalId: 'bshe', domain: 'www.rv.hessenrecht.hessen.de' },
};

export const JPORTAL_STATES = Object.keys(PORTALS);

const sessions = new Map<string, JPortalSession>();

function baseUrl(domain: string): string {
  return `https://${domain}/jportal/wsrest/recherche3`;
}

function jportalPolicy(domain: string): NetworkPolicy {
  return {
    name: `jportal ${domain}`,
    rules: [{
      hostname: domain,
      paths: [/^\/jportal\/wsrest\/recherche3\/(?:init|search|document)$/],
    }],
  };
}

async function getSession(state: string): Promise<JPortalSession> {
  const existing = sessions.get(state);
  if (existing) return existing;

  const config = PORTALS[state];
  if (!config) throw new Error(`No jportal config for state: ${state}`);

  logger.info('Initializing jportal session', { state, portalId: config.portalId });

  const response = await safeAxiosPost<JPortalInitResponse>(
    axios,
    `${baseUrl(config.domain)}/init`,
    {
      clientID: config.portalId,
      clientVersion: `${config.portalId} - V08_28_00`,
      r3ID: new Date().toISOString(),
    },
    jportalPolicy(config.domain),
    {
      headers: {
        'Content-Type': 'application/json',
        'JURIS-PORTALID': config.portalId,
        Cookie: `r3autologin="${config.portalId}"`,
      },
    },
  );

  const setCookie = response.headers['set-cookie'];
  const jsessionId = setCookie
    ?.find((c: string) => c.startsWith('JSESSIONID='))
    ?.match(/JSESSIONID=([^;]+)/)?.[1];

  if (!jsessionId || !response.data.csrfToken) {
    throw new Error(`jportal init failed for ${state}: no session or CSRF token`);
  }

  const session: JPortalSession = {
    jsessionId,
    csrfToken: response.data.csrfToken,
    portalId: config.portalId,
    domain: config.domain,
  };

  sessions.set(state, session);
  logger.info('jportal session established', { state, user: response.data.user?.login });
  return session;
}

function sessionHeaders(session: JPortalSession): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'JURIS-PORTALID': session.portalId,
    'X-CSRF-TOKEN': session.csrfToken,
    Cookie: `JSESSIONID=${session.jsessionId}; r3autologin="${session.portalId}"`,
  };
}

async function withRetry<T>(state: string, fn: (session: JPortalSession) => Promise<T>): Promise<T> {
  let session = await getSession(state);
  try {
    return await fn(session);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data?.msgId === 'security_notAuthenticated') {
      logger.info('Session expired, re-initializing', { state });
      sessions.delete(state);
      session = await getSession(state);
      return fn(session);
    }
    throw error;
  }
}

export async function jportalSearch(
  state: string,
  query: string,
  limit: number,
): Promise<JPortalSearchResult[]> {
  return withRetry(state, async (session) => {
    const response = await safeAxiosPost<JPortalSearchResponse>(
      axios,
      `${baseUrl(session.domain)}/search`,
      {
        clientID: session.portalId,
        clientVersion: `${session.portalId} - V08_28_00`,
        r3ID: new Date().toISOString(),
        searches: [{ id: 'FastSearch', value: query }],
        filters: { CATEGORY: ['Gesetze'] },
        searchTasks: {
          RESULT_LIST: { start: 1, size: limit, sort: 'scoreR3' },
          NUMBER_HITS: {},
        },
      },
      jportalPolicy(session.domain),
      { headers: sessionHeaders(session) },
    );

    const results: JPortalSearchResult[] = (response.data.resultList ?? []).map(
      (r: Record<string, unknown>) => ({
        docId: r.docId as string,
        title: ((r.titleList as string[]) || [])[0] || '',
        subtitle: ((r.subtitleList as string[]) || []).join(' | '),
        category: r.categoryId as string,
        date: r.date as string,
        docPart: r.docPart as string,
      }),
    );

    return results;
  });
}

/**
 * Decision hits plus the portal's own total. `NUMBER_HITS` has always been part
 * of the request; the response's `hits` field was simply never read, so a caller
 * could not tell ten of ten from ten of 2.148.
 */
export interface JPortalDecisionPage {
  results: JPortalSearchResult[];
  totalHits?: number;
}

/**
 * R3 packs decision metadata positionally, and the field names mislead: under
 * `CATEGORY: Rechtsprechung`, `titleList` is `[court, fileNumber]` and
 * `subtitleList` is `[decisionType, subject, citedNorms]`. Sampling 80 hits
 * across all ten portals found `titleList.length === 2` and
 * `subtitleList.length === 3` in 80 of 80, a digit in `titleList[1]` in 80 of
 * 80, and a recognizable decision type in `subtitleList[0]` in 79 of 80.
 *
 * Taking `titleList[0]` as the title is therefore why `rii_search` rendered an
 * empty `court` and `az` for all ten of these jurisdictions while the court
 * name sat in the title column — and why the file number was dropped outright.
 * Positions are read defensively even so: a portal that returns fewer parts
 * should degrade to a thinner row, never to an empty title.
 */
function decisionResult(raw: Record<string, unknown>): JPortalSearchResult {
  const titles = (raw.titleList as string[] | undefined) ?? [];
  const subtitles = (raw.subtitleList as string[] | undefined) ?? [];
  const court = titles[0]?.trim();
  const fileNumber = titles[1]?.trim();
  const result: JPortalSearchResult = {
    docId: raw.docId as string,
    title: subtitles[1]?.trim() || subtitles[0]?.trim() || court || '',
    // Still the full join. No column renders it, but it feeds relevance
    // scoring, where the decision type and the cited norms are worth matching.
    subtitle: subtitles.join(' | '),
    category: raw.categoryId as string,
    date: raw.date as string,
    docPart: raw.docPart as string,
    snippet: ((raw.snippetList as string[][]) || []).flat().join(' '),
  };
  if (court) result.court = court;
  if (fileNumber) result.fileNumber = fileNumber;
  return result;
}

export async function jportalDecisionSearch(
  state: string,
  query: string,
  limit: number,
  start = 1,
): Promise<JPortalDecisionPage> {
  return withRetry(state, async (session) => {
    const response = await safeAxiosPost<JPortalSearchResponse>(
      axios,
      `${baseUrl(session.domain)}/search`,
      {
        clientID: session.portalId,
        clientVersion: `${session.portalId} - V08_28_00`,
        r3ID: new Date().toISOString(),
        searches: [{ id: 'FastSearch', value: query }],
        filters: { CATEGORY: ['Rechtsprechung'] },
        searchTasks: {
          RESULT_LIST: { start, size: limit, sort: 'scoreR3' },
          NUMBER_HITS: {},
        },
      },
      jportalPolicy(session.domain),
      { headers: sessionHeaders(session) },
    );

    const total = response.data.hits;
    return {
      results: (response.data.resultList ?? []).map(decisionResult),
      // -1 is the portal's "not counted" marker, seen on the per-word `hits`.
      ...(typeof total === 'number' && total >= 0 ? { totalHits: total } : {}),
    };
  });
}

export async function jportalGetDocument(
  state: string,
  docId: string,
  docPart = 'S',
): Promise<JPortalDocument> {
  return withRetry(state, async (session) => {
    const response = await safeAxiosPost<JPortalDocumentResponse>(
      axios,
      `${baseUrl(session.domain)}/document`,
      {
        clientID: session.portalId,
        clientVersion: `${session.portalId} - V08_28_00`,
        r3ID: new Date().toISOString(),
        docId,
        docPart,
        format: 'xsl',
      },
      jportalPolicy(session.domain),
      { headers: sessionHeaders(session) },
    );

    const data = response.data;
    return {
      title: data.documentTitle?.title?.trim() || '',
      head: data.head || '',
      text: data.text || '',
      permalink: data.permalink || '',
    };
  });
}

export function invalidateSession(state: string): void {
  sessions.delete(state);
}

export function invalidateAllSessions(): void {
  sessions.clear();
}
