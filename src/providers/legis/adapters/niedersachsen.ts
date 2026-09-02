import { HTTP_USER_AGENT } from '../../../config.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { rootLogger } from '../../../shared/logger.js';
import type { LegisAdapter, SearchResult, LegisEntry, TocEntry } from '../types.js';
import { safeAxiosGet } from '../../../shared/network-policy.js';
import { LEGIS_NIEDERSACHSEN_POLICY } from '../network-policy.js';

const logger = rootLogger.child({ module: 'ni-adapter' });
const BASE = 'https://voris.wolterskluwer-online.de';
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

export class NiedersachsenAdapter implements LegisAdapter {
  readonly states = ['NI'] as const;

  async search(_state: string, query: string, limit: number): Promise<SearchResult[]> {
    logger.info('Searching NI-VORIS', { queryLength: query.length });
    const { data } = await safeAxiosGet<string>(axios, `${BASE}/search`, LEGIS_NIEDERSACHSEN_POLICY, {
      params: { query },
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });

    const $ = cheerio.load(data);
    const results: SearchResult[] = [];

    $('h3 > a[href^="/browse/document/"]').each((_, el) => {
      if (results.length >= limit) return false;
      const href = $(el).attr('href') || '';
      const id = href.split('/').pop() || '';
      results.push({
        id,
        title: $(el).text().trim(),
        subtitle: $(el).closest('.egal-search-result-item-title')
          .next('.egal-search-result-item-snippet').text().trim(),
        date: '',
      });
      return undefined;
    });

    return results;
  }

  async get(_state: string, id: string): Promise<LegisEntry> {
    logger.info('Fetching NI-VORIS document', { id });
    const url = `${BASE}/browse/document/${id}`;
    const { data } = await safeAxiosGet<string>(axios, url, LEGIS_NIEDERSACHSEN_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });

    const $ = cheerio.load(data);
    const title = $('title').text().replace(/\s*\|.*$/, '').trim();

    // Strip TOC and navigation, keep footnotes (contain editorial notes)
    const body = $('.wkde-document-body');
    body.find('.law-toc, nav, [role="navigation"]').remove();
    // Strip internal cite links — keep text only
    body.find('a.internal-cite').each((_, el) => {
      $(el).replaceWith($(el).text());
    });
    // Strip sentence number superscripts (e.g. <sup class="satz">1</sup>)
    body.find('sup.satz').remove();

    const content = turndown.turndown(body.html() || '');

    return { title, content, url };
  }

  async toc(_state: string, id: string): Promise<TocEntry[]> {
    const { data } = await safeAxiosGet<string>(axios, `${BASE}/browse/document/${id}`, LEGIS_NIEDERSACHSEN_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = cheerio.load(data);
    const entries: TocEntry[] = [];

    $('.wk-tree-node-label[data-level]').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (!text || text.includes('anzeigen') || text.includes('vergleichen') || text.includes('herunterladen') || text.includes('drucken') || text.includes('hervorheben') || text.includes('Vollbild')) return;
      const level = parseInt($(el).attr('data-level') || '0', 10);
      // Parse "§§ 1 - 3, Erster Teil - Aufgaben..." or "Anlage NPOG"
      const m = text.match(/^(§§?\s*[\d\s\-a-z]+),\s*(.*)/i);
      entries.push({
        depth: level,
        num: m?.[1]?.trim() || '',
        title: m?.[2]?.trim() || text,
      });
    });

    return entries;
  }
}
