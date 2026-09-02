import { HTTP_USER_AGENT } from '../../../config.js';
import axios from 'axios';
import { load } from 'cheerio';
import TurndownService from 'turndown';
import type { LegisAdapter, SearchResult, LegisEntry } from '../types.js';
import { safeAxiosGet, safeAxiosPost } from '../../../shared/network-policy.js';
import { LEGIS_BAYERN_POLICY } from '../network-policy.js';

const BASE = 'https://www.gesetze-bayern.de';
const turndown = new TurndownService({ headingStyle: 'atx' });

export class BayernAdapter implements LegisAdapter {
  readonly states = ['BY'] as const;

  async search(_state: string, query: string, limit: number): Promise<SearchResult[]> {
    // Get CSRF token + cookies
    const page = await safeAxiosGet<string>(axios, `${BASE}/Search`, LEGIS_BAYERN_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const cookies = page.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const $ = load(page.data);
    const token = $('input[name=__RequestVerificationToken]').val();

    const resp = await safeAxiosPost<string>(
      axios,
      `${BASE}/Search`,
      `SearchFields.Content=${encodeURIComponent(query)}&__RequestVerificationToken=${encodeURIComponent(String(token))}`,
      LEGIS_BAYERN_POLICY,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookies || '',
          'User-Agent': HTTP_USER_AGENT,
        },
        maxRedirects: 5,
      },
    );

    const $r = load(resp.data);
    const skip = new Set(['Rss', 'ffn', 'ffn-mbl', 'Datenschutz', 'Impressum', 'Barrierefreiheit', 'Hilfe']);
    const results: SearchResult[] = [];
    $r('a[href^="/Content/Document/"]').each((_, el) => {
      const href = $r(el).attr('href')!;
      const id = href.replace('/Content/Document/', '').replace('/true', '');
      if (skip.has(id) || results.length >= limit || results.some((r) => r.id === id)) return;
      results.push({ id, title: $r(el).text().trim(), subtitle: '', date: '' });
    });
    return results;
  }

  async get(_state: string, id: string): Promise<LegisEntry> {
    const resp = await safeAxiosGet<string>(axios, `${BASE}/Content/Document/${id}`, LEGIS_BAYERN_POLICY);
    const $ = load(resp.data);

    const title = $('title').text().replace(' - Bürgerservice', '').trim();

    // Strip navigation tree
    $('.tree').remove();
    const content = turndown.turndown($('.cont').html() || $('.panel-body').html() || '');

    return { title, content, url: `${BASE}/Content/Document/${id}` };
  }
}
