import axios from 'axios';
import { load } from 'cheerio';
import TurndownService from 'turndown';
import type { LegisAdapter, SearchResult, LegisEntry } from '../types.js';
import { safeAxiosGet, safeAxiosPost } from '../../../shared/network-policy.js';
import { LEGIS_SACHSEN_POLICY } from '../network-policy.js';

const BASE = 'https://www.revosax.sachsen.de';
const turndown = new TurndownService({ headingStyle: 'atx' });

export class SachsenAdapter implements LegisAdapter {
  readonly states = ['SN'] as const;

  async search(_state: string, query: string, limit: number): Promise<SearchResult[]> {
    const page = await safeAxiosGet<string>(axios, `${BASE}/vorschriftensuche`, LEGIS_SACHSEN_POLICY);
    const cookies = page.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');
    const $ = load(page.data);
    const token = $('input[name=authenticity_token]').first().val();

    const resp = await safeAxiosPost<string>(
      axios,
      `${BASE}/suche`,
      `authenticity_token=${encodeURIComponent(String(token))}&search_request%5Bsearch_text%5D=${encodeURIComponent(query)}&search_request%5Bmode%5D=fullsearch&search_request%5Btitle_search%5D=1`,
      LEGIS_SACHSEN_POLICY,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies || '' },
        maxRedirects: 5,
      },
    );

    const $r = load(resp.data);
    const results: SearchResult[] = [];
    $r('a[href^="/vorschrift/"]').each((_, el) => {
      const href = $r(el).attr('href')!;
      if (href.includes('suche') || results.length >= limit) return;
      const id = href.replace('/vorschrift/', '');
      if (!results.some((r) => r.id === id)) {
        results.push({ id, title: $r(el).text().trim(), subtitle: '', date: '' });
      }
    });
    return results;
  }

  async get(_state: string, id: string): Promise<LegisEntry> {
    const resp = await safeAxiosGet<string>(axios, `${BASE}/vorschrift/${id}`, LEGIS_SACHSEN_POLICY);
    const $ = load(resp.data);

    const title = $('h1').first().text().trim();
    // Strip navigation, internal links to other Vorschriften
    $('.menu, .breadcrumbs, .jump, .only_print, .satzzahl, nav').remove();
    $('a[href^="/vorschrift/"]').each((_, el) => {
      $(el).replaceWith($(el).text());
    });
    // Replace <br> in headings with spaces (Turndown splits them into separate lines)
    $('h1 br, h2 br, h3 br, h4 br').replaceWith(' ');

    const content = turndown.turndown($('.law_show').html() || '');
    return { title, content, url: `${BASE}/vorschrift/${id}` };
  }
}
