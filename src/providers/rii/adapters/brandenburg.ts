import axios, { type AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { HTTP_USER_AGENT } from '../../../config.js';
import type { DecisionAdapter, DecisionEntry, DecisionPage, DecisionSearchResult } from '../types.js';
import { safeAxiosGet } from '../../../shared/network-policy.js';
import { RII_BRANDENBURG_POLICY } from '../network-policy.js';

const BASE = 'https://gerichtsentscheidungen.brandenburg.de';
const turndown = new TurndownService({ headingStyle: 'atx' });

export class BrandenburgDecisionAdapter implements DecisionAdapter {
  readonly sources = ['BB'] as const;

  constructor(private readonly http: Pick<AxiosInstance, 'get'> = axios) {}

  async search(_source: string, query: string, limit: number): Promise<DecisionSearchResult[]> {
    return (await this.searchPage(_source, query, limit)).results;
  }

  /**
   * No file number, deliberately. The result table's columns are row number,
   * Typ, Datum, Bezeichnung and Gericht — there is no Aktenzeichen among them,
   * the row and its link carry no title or data attribute holding one, and the
   * file numbers that do appear inside Bezeichnung text ("Zu der Entscheidung
   * 6 U 54/26") are references to *other* decisions rather than the row's own.
   *
   * Recovering it would mean fetching every result's detail page, turning one
   * search into N+1 requests, so `az` stays empty for BB while every other
   * source fills it. `get` reads it from the detail page's metadata table.
   */
  async searchPage(_source: string, query: string, limit: number, page = 1): Promise<DecisionPage> {
    const response = await safeAxiosGet<string>(this.http, `${BASE}/suche`, RII_BRANDENBURG_POLICY, {
      params: { input_fulltext: query, ...(page > 1 ? { page: String(page) } : {}) },
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = cheerio.load(response.data);
    const results = $('#resultlist tbody tr').slice(0, limit).map((_, el) => {
      const cells = $(el).find('td');
      const link = cells.eq(3).find('a');
      return { id: link.attr('href')?.split('/').pop() || '', title: link.text().replace(/\s+/g, ' ').trim(), subtitle: `${cells.eq(1).text().trim()} | ${cells.eq(4).text().replace(/\s+/g, ' ').trim()}`, date: cells.eq(2).text().trim(), court: cells.eq(4).text().replace(/\s+/g, ' ').trim() };
    }).get();
    return { results };
  }

  async get(_source: string, id: string): Promise<DecisionEntry> {
    const url = `${BASE}/gerichtsentscheidung/${id}`;
    const response = await safeAxiosGet<string>(this.http, url, RII_BRANDENBURG_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = cheerio.load(response.data);
    const metadata: Record<string, string> = {};
    $('#metadata th').each((_, el) => { metadata[$(el).text().replace(/\s+/g, ' ').trim().toLowerCase()] = $(el).next('td').text().replace(/\s+/g, ' ').trim(); });
    const title = $('#metadata h1#header').text().replace(/\s+/g, ' ').trim();
    const contentRoot = $('#gerichtsentscheidung-detail');
    contentRoot.find('nav, script, style, .bb-link-bar, .bb-breadcrumbs').remove();
    const content = turndown.turndown(contentRoot.html() || '');
    return { title, content, url, court: metadata.gericht || '', date: metadata.entscheidungsdatum || '', fileNumber: metadata.aktenzeichen || '', ...(metadata.ecli ? { ecli: metadata.ecli } : {}) };
  }
}
