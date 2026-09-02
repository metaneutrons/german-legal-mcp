import axios, { type AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { HTTP_USER_AGENT } from '../../../config.js';
import type { DecisionAdapter, DecisionEntry, DecisionPage, DecisionSearchResult } from '../types.js';
import { safeAxiosGet } from '../../../shared/network-policy.js';
import { RII_BREMEN_POLICY } from '../network-policy.js';

const OVERVIEW = 'https://www.verwaltungsgericht.bremen.de/entscheidungen/entscheidungsuebersicht-13039';
const turndown = new TurndownService({ headingStyle: 'atx' });

/**
 * Bremen's index puts three fields in one link title:
 * `subject, fileNumber, type vom date` — for example
 * `Schulzuweisung Sek I, 1 V 2155/26, Beschluss vom 29.07.2026`.
 *
 * Only the date suffix was being stripped, which left the file number sitting
 * inside the title while the `az` column stayed empty.
 *
 * Subjects contain commas of their own — `Disziplinarrecht Bundesbeamte,
 * Aussetzung vorläufige Dienstenthebung, 8 V 1410/26, Beschluss vom
 * 23.07.2026`. What keeps the middle clause from being read as the file number
 * is anchoring the trailing `type vom date` to the end of the string, which
 * admits exactly one split; flipping the subject group between greedy and lazy
 * changes nothing, so the anchor is the load-bearing part rather than the
 * quantifier.
 *
 * Requiring a digit in the file-number group is the second guard, and that one
 * is not redundant: without it any three-clause title ending in a decision line
 * would donate its middle clause as a file number.
 */
export function parseBremenLinkTitle(linkTitle: string): { fileNumber?: string; title: string } {
  const match = linkTitle.match(/^(.+),\s*([^,]*\d[^,]*),\s*\S+\s+vom\s+\d{2}\.\d{2}\.\d{4}$/);
  if (!match) {
    // Unrecognized: fall back to the previous behaviour of dropping just the
    // trailing decision-and-date clause.
    return { title: linkTitle.replace(/,?\s*\S+\s+vom\s+[\d.]+$/, '').trim() };
  }
  const [, subject, fileNumber] = match;
  const parsed: { fileNumber?: string; title: string } = { title: subject?.trim() || linkTitle };
  if (fileNumber?.trim()) parsed.fileNumber = fileNumber.trim();
  return parsed;
}

/** Bremen has no state-wide search API; the official index currently exposes the VG archive. */
export class BremenDecisionAdapter implements DecisionAdapter {
  readonly sources = ['HB'] as const;
  constructor(private readonly http: Pick<AxiosInstance, 'get'> = axios) {}

  async search(_source: string, query: string, limit: number): Promise<DecisionSearchResult[]> {
    return (await this.searchPage(_source, query, limit)).results;
  }

  /**
   * First page only, and that is the source's own limit rather than ours: the
   * official index is a rolling list of recent VG decisions with no archive or
   * pager to follow.
   */
  async searchPage(_source: string, query: string, limit: number, page = 1): Promise<DecisionPage> {
    if (page > 1) return { results: [], pagingUnsupported: true };
    const response = await safeAxiosGet<string>(this.http, OVERVIEW, RII_BREMEN_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = cheerio.load(response.data);
    const needle = query.toLocaleLowerCase('de-DE');
    const results = $('tr.search-result').map((_, row) => {
      const cells = $(row).find('td');
      const date = cells.eq(0).find('em').text().trim();
      const text = cells.eq(1).text().replace(/\s+/g, ' ').trim();
      const link = cells.eq(1).find('a[title]').last();
      const linkTitle = link.attr('title');
      const parsed = linkTitle ? parseBremenLinkTitle(linkTitle) : { title: text };
      const href = link.attr('href');
      const url = href ? new URL(href, OVERVIEW).toString() : '';
      return {
        id: url,
        title: parsed.title || text,
        subtitle: text,
        date,
        court: 'Verwaltungsgericht Bremen',
        ...(parsed.fileNumber ? { fileNumber: parsed.fileNumber } : {}),
        url,
      };
    }).get().filter((result) => !needle || `${result.title} ${result.subtitle}`.toLocaleLowerCase('de-DE').includes(needle)).slice(0, limit);
    return { results };
  }

  async get(_source: string, id: string): Promise<DecisionEntry> {
    const url = id.startsWith('http') ? id : new URL(id, OVERVIEW).toString();
    const response = await safeAxiosGet<string>(this.http, url, RII_BREMEN_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = cheerio.load(response.data);
    const root = $('.main_article, main, article').first();
    const title = $('h1').first().text().replace(/\s+/g, ' ').trim() || $('title').text().trim();
    root.find('nav, script, style, form, .breadcrumb, .socialmedia').remove();
    const metadata = root.text().replace(/\s+/g, ' ');
    return { title, content: turndown.turndown(root.html() || ''), url, court: 'Verwaltungsgericht Bremen', date: metadata.match(/(?:vom|am)\s+(\d{2}\.\d{2}\.\d{4})/)?.[1] || '', fileNumber: metadata.match(/\b\d+\s+[VK]\s+\d+\/\d+\b/)?.[0] || '' };
  }
}
