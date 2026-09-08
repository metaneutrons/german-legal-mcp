import axios from 'axios';
import { load } from 'cheerio';
import TurndownService from 'turndown';
import type { LegisAdapter, SearchResult, LegisEntry } from '../types.js';
import { rankSearchResults, type RankableSearchResult } from './search-ranking.js';
import { assertUrlAllowed, safeAxiosGet } from '../../../shared/network-policy.js';
import { LEGIS_BREMEN_POLICY } from '../network-policy.js';

const BASE = 'https://www.transparenz.bremen.de';
const turndown = new TurndownService({ headingStyle: 'atx' });

function docUrl(id: string): string {
  if (id.startsWith('http://') || id.startsWith('https://')) {
    const url = new URL(assertUrl(id));
    url.searchParams.set('asl', 'bremen203_tpgesetz.c.55340.de');
    url.searchParams.set('template', '20_gp_ifg_meta_detail_d');
    return url.toString();
  }
  return `${BASE}/sixcms/detail.php?gsid=bremen2014_tp.c.${id}.de&asl=bremen203_tpgesetz.c.55340.de&template=20_gp_ifg_meta_detail_d`;
}

function assertUrl(url: string): string {
  return assertUrlAllowed(url, LEGIS_BREMEN_POLICY).toString();
}

function toSearchResult(result: RankableSearchResult): SearchResult {
  return {
    id: result.id,
    title: result.title,
    subtitle: result.subtitle,
    date: result.date,
  };
}

export class BremenAdapter implements LegisAdapter {
  readonly states = ['HB'] as const;

  async search(_state: string, query: string, limit: number): Promise<SearchResult[]> {
    const resp = await safeAxiosGet<string>(axios, `${BASE}/sixcms/detail.php`, LEGIS_BREMEN_POLICY, {
      params: {
        template: '20_search_d',
        'search[send]': 'true',
        'search[vt]': query,
        max: Math.max(20, limit * 5),
        lang: 'de',
      },
    });

    const $ = load(resp.data);
    const results: RankableSearchResult[] = [];
    $('h2.inhaltsseiten > a[href*="metainformationen/"]').each((_, el) => {
      const href = $(el).attr('href')!;
      const text = $(el).text().trim();
      if (!text || text.length < 5 || text.includes('Zur Inhaltsseite') || text.includes('zur News')) return;
      const id = new URL(href, BASE).toString();
      if (!results.some((r) => r.id === id)) {
        results.push({
          id,
          title: text,
          subtitle: '',
          date: '',
          rankText: `${text} ${href}`,
          isRootDocument: true,
        });
      }
    });
    return rankSearchResults(results, query, limit).map(toSearchResult);
  }

  async get(_state: string, id: string): Promise<LegisEntry> {
    const url = docUrl(id);
    const resp = await safeAxiosGet<string>(axios, url, LEGIS_BREMEN_POLICY, { maxRedirects: 5 });
    const $ = load(resp.data);

    const title = $('title').text().replace(/\s*-\s*Transparenzportal Bremen$/, '').trim();
    const content = $('.main_article.gesetz');
    content.find('.interfaceicon, .jwsinhaltsverzeichnis, .docLayoutCopyright, .documentHeader, .jgwsHead, .jgwsTitle, script').remove();
    content.find('a[href*="javascript"], a[href*="verschicken"], a[href*="#inhaltsverzeichnis"]').remove();
    // Strip internal anchor links (TOC entries like [§ 1](#jlr-...))
    content.find('a[href^="#jlr-"], a[href^="#P"]').each((_, el) => {
      $(el).replaceWith($(el).text());
    });
    $('h1 br, h2 br, h3 br, h4 br, h5 br').replaceWith(' ');

    const md = turndown.turndown(content.html() || '');
    return { title, content: md, url: resp.request?.res?.responseUrl || url };
  }
}
