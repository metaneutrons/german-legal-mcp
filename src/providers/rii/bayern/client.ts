import axios from 'axios';
import { load } from 'cheerio';
import { safeAxiosGet, safeAxiosPost } from '../../../shared/network-policy.js';
import { RII_BAYERN_POLICY } from '../network-policy.js';

const BASE_URL = 'https://www.gesetze-bayern.de';

interface BayernSession {
  cookies: string;
  token: string;
}

let session: BayernSession | null = null;

async function getSession(): Promise<BayernSession> {
  if (session) return session;
  const res = await safeAxiosGet<string>(axios, BASE_URL, RII_BAYERN_POLICY, { timeout: 15000 });
  const cookies = (res.headers['set-cookie'] || []).map((c: string) => c.split(';')[0]).join('; ');
  const $ = load(res.data);
  const token = $('input[name="__RequestVerificationToken"]').val() as string;
  session = { cookies, token };
  return session;
}

/**
 * Bayern prints "2639 Treffer in 2608 Gerichtsentscheidungen". The first figure
 * counts matches, the second distinct decisions; the decision count is the one
 * that lines up with what the result list can actually return.
 */
export function parseBayernTotalHits(html: string): number | undefined {
  const match = html.match(/([\d.]+)\s*Treffer\s+in\s+([\d.]+)\s*Gerichtsentscheidungen/)
    ?? html.match(/([\d.]+)\s*Treffer/);
  const raw = match?.[2] ?? match?.[1];
  if (!raw) return undefined;
  const total = Number.parseInt(raw.replace(/\./g, ''), 10);
  return Number.isNaN(total) ? undefined : total;
}

export async function searchBayern(query: string, limit: number, page = 1): Promise<{ results: { title: string; docId: string; subtitle: string }[]; totalHits?: number }> {
  const s = await getSession();
  // Page one is the POST result; later pages are GETs against the retained
  // search, which is how the site's own pager works.
  const res = page > 1
    ? await safeAxiosGet<string>(axios, `${BASE_URL}/Search/Page/${page}`, RII_BAYERN_POLICY, {
      headers: { Cookie: s.cookies }, timeout: 15000,
    })
    : await safeAxiosPost<string>(axios, `${BASE_URL}/Search`, `__RequestVerificationToken=${encodeURIComponent(s.token)}&SearchFields.Content=${encodeURIComponent(query)}`, RII_BAYERN_POLICY, {
      headers: { Cookie: s.cookies, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });

  const $ = load(res.data);
  const results: { title: string; docId: string; subtitle: string }[] = [];

  $('a.hltitel, p.hltitel a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/\/Content\/Document\/([^?]+)/);
    const docId = match?.[1];
    if (docId === undefined || !docId.startsWith('Y-')) return;
    const title = $(el).text().trim();
    const subtitle = $(el).closest('div').find('.hlSubTitel, p.hlSubTitel').text().trim();
    results.push({ title, docId, subtitle });
  });

  const totalHits = parseBayernTotalHits(res.data);
  return { results: results.slice(0, limit), ...(totalHits === undefined ? {} : { totalHits }) };
}

export async function fetchBayernDecision(docId: string): Promise<string> {
  const res = await safeAxiosGet<string>(axios, `${BASE_URL}/Content/Document/${docId}`, RII_BAYERN_POLICY, { timeout: 15000 });
  return res.data;
}
