import axios from 'axios';
import { load } from 'cheerio';
import TurndownService from 'turndown';
import type { LegisAdapter, SearchResult, LegisEntry } from '../types.js';
import { rankSearchResults, type RankableSearchResult } from './search-ranking.js';
import { safeAxiosGet, safeAxiosPost } from '../../../shared/network-policy.js';
import { LEGIS_BRANDENBURG_POLICY } from '../network-policy.js';

const BASE = 'https://bravors.brandenburg.de';
const turndown = new TurndownService({ headingStyle: 'atx' });
const BRANDENBURG_PREFIX = 'Bbg';

function searchVariants(query: string): string[] {
  const variants = [query];
  const compact = query.replace(/\s+/g, '');
  const prefixed = compact.match(/^Bbg(.+)$/);
  if (prefixed?.[1]) variants.push(`${prefixed[1]}Bbg`, prefixed[1]);
  return [...new Set(variants)];
}

function abbreviationAliases(text: string): string {
  const aliases: string[] = [];
  for (const match of text.matchAll(/\(([^()]+)\)/g)) {
    const abbreviation = match[1]?.split(/\s[-–]\s/).pop()?.trim();
    if (!abbreviation) continue;
    aliases.push(abbreviation);
    if (abbreviation.endsWith(BRANDENBURG_PREFIX)) {
      aliases.push(`${BRANDENBURG_PREFIX}${abbreviation.slice(0, -BRANDENBURG_PREFIX.length)}`);
    }
  }
  return aliases.join(' ');
}

function toSearchResult(result: RankableSearchResult): SearchResult {
  return {
    id: result.id,
    title: result.title,
    subtitle: result.subtitle,
    date: result.date,
  };
}

export class BrandenburgAdapter implements LegisAdapter {
  readonly states = ['BB'] as const;

  async search(_state: string, query: string, limit: number): Promise<SearchResult[]> {
    const allResults: RankableSearchResult[] = [];

    for (const term of searchVariants(query)) {
      const page = await safeAxiosGet(axios, `${BASE}/de/vorschriften_schnellsuche`, LEGIS_BRANDENBURG_POLICY);
      const cookies = page.headers['set-cookie']?.map((c: string) => c.split(';')[0]).join('; ');

      const resp = await safeAxiosPost<string>(
        axios,
        `${BASE}/de/vorschriften_schnellsuche`,
        `search%5Bsearchterm%5D=${encodeURIComponent(term)}&search%5Bart_vorschrift%5D=alle&suchen=Suchen`,
        LEGIS_BRANDENBURG_POLICY,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies || '' },
          maxRedirects: 5,
        },
      );

      const $ = load(resp.data);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')!;
        if (
          (href.startsWith('/gesetze/') || href.startsWith('/verordnungen/') || href.startsWith('/verwaltungsvorschriften/')) &&
          !href.includes('/list')
        ) {
          const id = href.replace(/^\//, '');
          const title = $(el).text().trim();
          if (!allResults.some((r) => r.id === id)) {
            allResults.push({
              id,
              title,
              subtitle: '',
              date: '',
              rankText: `${title} ${id} ${abbreviationAliases(title)}`,
              isRootDocument: href.startsWith('/gesetze/') || href.startsWith('/verordnungen/'),
            });
          }
        }
      });
    }

    return rankSearchResults(allResults, query, limit).map(toSearchResult);
  }

  async get(_state: string, id: string): Promise<LegisEntry> {
    const resp = await safeAxiosGet<string>(axios, `${BASE}/${id}`, LEGIS_BRANDENBURG_POLICY);
    const $ = load(resp.data);

    const title = $('title').text().trim();
    $('.helpbox, #help_box, .reiter_gruppe, .partizipations_plugin, .services, .nav2_inner, .br2_inner_index').remove();
    $('h1 br, h2 br, h3 br, h4 br').replaceWith(' ');

    const content = turndown.turndown($('.reiterbox_innen_2').html() || '');
    return { title, content, url: `${BASE}/${id}` };
  }
}
