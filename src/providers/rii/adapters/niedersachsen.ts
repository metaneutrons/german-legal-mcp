import axios, { type AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { HTTP_USER_AGENT } from '../../../config.js';
import type { DecisionAdapter, DecisionEntry, DecisionPage, DecisionSearchResult } from '../types.js';
import { safeAxiosGet } from '../../../shared/network-policy.js';
import { RII_NIEDERSACHSEN_POLICY } from '../network-policy.js';

const BASE = 'https://voris.wolterskluwer-online.de';
const turndown = new TurndownService({ headingStyle: 'atx' });

function labelledValue(text: string, normalizedText: string, label: string): string | undefined {
  const offset = normalizedText.indexOf(label.toLocaleLowerCase('de-DE'));
  if (offset < 0) return undefined;
  const remainder = text.slice(offset + label.length).trimStart();
  const value = (remainder.startsWith(':') ? remainder.slice(1) : remainder).trim();
  return value || undefined;
}

/**
 * NI reports counts per facet rather than one overall figure. The search filters
 * to Rechtsprechung, so that facet's own count is the matching total.
 */
export function parseNiedersachsenTotalHits(html: string): number | undefined {
  const match = html.match(/Rechtsprechung Filter\s*(\d+)\s*Ergebnisse/);
  if (!match?.[1]) return undefined;
  const total = Number.parseInt(match[1], 10);
  return Number.isNaN(total) ? undefined : total;
}

/**
 * NI packs several fields into one result heading: `court, date - fileNumber`,
 * optionally followed by ` - subject`. Sampling 48 headings across four queries
 * found the four-part form in 48 of 48, always with a digit in the file number;
 * the three-part form (no subject) also occurs and is what the stored fixture
 * carries.
 *
 * Only the court was being recovered, so `rii_search` rendered an empty `az`
 * for this source while the file number sat in plain sight inside the title —
 * and the court, date and file number each ate into the title column's width
 * despite having columns of their own.
 *
 * The subject is split off by scanning for the first ` - ` rather than with one
 * regex over the whole heading, so that the optional trailing part cannot make
 * the engine prefer a shorter file number than intended. The separator requires
 * surrounding whitespace for the same reason a bare `-` is not enough: it would
 * split a file number such as `2 BvR 1-2/20` down the middle.
 */
export function parseNiedersachsenHeading(heading: string): {
  court?: string;
  date?: string;
  fileNumber?: string;
  title: string;
} {
  const match = heading.match(/^(.+?),\s*(\d{2}\.\d{2}\.\d{4})\s+-\s+(.+)$/);
  if (!match) {
    // An unrecognized heading is kept whole rather than guessed at, but the
    // court only needs the leading comma, so that much is still worth having.
    const fallbackCourt = heading.match(/^([^,]+),/)?.[1]?.trim();
    return { title: heading, ...(fallbackCourt ? { court: fallbackCourt } : {}) };
  }

  const [, court, date, rest = ''] = match;
  const separator = rest.search(/\s+-\s+/);
  const fileNumber = (separator === -1 ? rest : rest.slice(0, separator)).trim();
  const subject = separator === -1 ? '' : rest.slice(separator).replace(/^\s+-\s+/, '').trim();

  const parsed: { court?: string; date?: string; fileNumber?: string; title: string } = {
    // With no subject every part already has its own column, but an empty title
    // cell is worse than a redundant one, so the heading stands in.
    title: subject || heading,
  };
  if (court?.trim()) parsed.court = court.trim();
  if (date?.trim()) parsed.date = date.trim();
  if (fileNumber) parsed.fileNumber = fileNumber;
  return parsed;
}

/**
 * Distinguishes NI's "no hits" 404 from a 404 that means the endpoint moved.
 *
 * Both carry the site chrome, so status and body size decide nothing. The
 * portal's own empty state is the discriminator — measured: a zero-result
 * search 404s *with* it, a bogus path 404s *without* it, and a search with hits
 * returns 200 and never contains it.
 */
export function isEmptyResultResponse(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status !== 404) return false;
  const body = (error as { response?: { data?: unknown } })?.response?.data;
  return (
    typeof body === 'string'
    && /view-empty|keine passenden Dokumente gefunden/i.test(body)
  );
}

export class NiedersachsenDecisionAdapter implements DecisionAdapter {
  readonly sources = ['NI'] as const;

  constructor(private readonly http: Pick<AxiosInstance, 'get'> = axios) {}

  async search(_source: string, query: string, limit: number): Promise<DecisionSearchResult[]> {
    return (await this.searchPage(_source, query, limit)).results;
  }

  async searchPage(_source: string, query: string, limit: number, page = 1): Promise<DecisionPage> {
    let response;
    try {
      response = await safeAxiosGet<string>(this.http, `${BASE}/search`, RII_NIEDERSACHSEN_POLICY, {
        params: { query, pit: 'in_force', publicationtype: 'publicationform-ats-filter!ATS_Rechtsprechung', ...(page > 1 ? { page: String(page) } : {}) },
        headers: { 'User-Agent': HTTP_USER_AGENT },
      });
    } catch (error) {
      // NI answers a search with no hits using 404 and a full results page
      // carrying its own empty state, so an unfiltered failure here reported
      // "source unavailable" for every query the portal simply had no matches
      // for — which is most of them. It is why NI contributed nothing to an
      // ingest while working perfectly when tested with a term that does match.
      if (isEmptyResultResponse(error)) return { results: [] };
      throw error;
    }
    const $ = cheerio.load(response.data);
    const results = $('.egal-search-result-item-title h3 a[href^="/browse/document/"]').slice(0, limit).map((_, el) => {
      const item = $(el).closest('.views-row, .egal-search-result-item');
      const extra = item.find('.egal-search-result-item-extra').text().replace(/\s+/g, ' ').trim();
      const heading = parseNiedersachsenHeading($(el).text().replace(/\s+/g, ' ').trim());
      // The labelled facet date is authoritative where present; the heading's
      // own date is the fallback for items that omit the facet.
      const date = extra.match(/Entscheidungsdatum:\s*([\d.]+)/)?.[1] || heading.date || '';
      return {
        id: $(el).attr('href')?.split('/').pop() || '',
        title: heading.title,
        subtitle: item.find('.egal-search-result-item-snippet').text().replace(/\s+/g, ' ').trim(),
        date,
        ...(heading.court ? { court: heading.court } : {}),
        ...(heading.fileNumber ? { fileNumber: heading.fileNumber } : {}),
      };
    }).get();
    const totalHits = parseNiedersachsenTotalHits(response.data);
    return { results, ...(totalHits === undefined ? {} : { totalHits }) };
  }

  async get(_source: string, id: string): Promise<DecisionEntry> {
    const url = `${BASE}/browse/document/${id}`;
    const response = await safeAxiosGet<string>(this.http, url, RII_NIEDERSACHSEN_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = cheerio.load(response.data);
    const title = $('.wkde-doctitle, h1').first().text().replace(/\s+/g, ' ').trim()
      || $('title').text().replace(/\s*\|.*$/, '').trim();
    const metadata: Record<string, string> = {};
    $('.wkde-bibliography dt').each((_, el) => {
      const label = $(el).text().replace(/\s+/g, ' ').trim().toLocaleLowerCase('de-DE');
      const value = $(el).next('dd').text().replace(/\s+/g, ' ').trim();
      if (label && value) metadata[label] = value;
    });
    $('.views-field, .field').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const normalizedText = text.toLocaleLowerCase('de-DE');
      for (const label of ['Gericht', 'Entscheidungsdatum', 'Aktenzeichen', 'ECLI']) {
        const value = labelledValue(text, normalizedText, label);
        if (value) metadata[label.toLowerCase()] = value;
      }
    });
    const body = $('.wkde-document-body');
    body.find('.law-toc, nav, [role="navigation"], .wkde-document-tools').remove();
    body.find('a.internal-cite').each((_, el) => { $(el).replaceWith($(el).text()); });
    const content = turndown.turndown(body.html() || '');
    return {
      title,
      content,
      url,
      court: metadata.gericht || '',
      date: metadata.entscheidungsdatum || metadata.datum || '',
      fileNumber: metadata.aktenzeichen || '',
      ...(metadata.ecli ? { ecli: metadata.ecli } : {}),
    };
  }
}
