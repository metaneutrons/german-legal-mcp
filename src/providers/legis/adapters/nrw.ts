import axios from 'axios';
import { load } from 'cheerio';
import TurndownService from 'turndown';
import type { LegisAdapter, SearchResult, LegisEntry, TocEntry } from '../types.js';
import { rankSearchResults, type RankableSearchResult } from './search-ranking.js';
import { safeAxiosGet, safeAxiosPost } from '../../../shared/network-policy.js';
import { LEGIS_NRW_POLICY } from '../network-policy.js';

const BASE = 'https://recht.nrw.de';
const SEARCH = `${BASE}/search-middleware/opensearch_internet/_search`;
const turndown = new TurndownService({ headingStyle: 'atx' });
const NRW_SEARCH_FETCH_LIMIT = 100;
const NRW_TITLE_FIELDS = ['field_long_title', 'field_short_title', 'field_abbreviation', 'title'] as const;
const NRW_BODY_FIELDS = [
  'field_body_field_footnotes_field_footnote_description_processed',
  'field_body_field_headline',
  'field_body_field_num',
  'field_body_field_reference_title',
  'field_body_field_text_processed',
  'field_change_history_footnote_field_footnote_description_processed',
  'field_change_history_footnote_field_reference_title',
  'field_conclusions_field_footnotes_field_footnote_description_processed',
  'field_conclusions_field_reference_title',
  'field_conclusions_field_text_processed',
  'field_footnotes_field_reference_title',
  'field_full_quotation_processed',
  'field_preamble_field_footnotes_field_footnote_description_processed',
  'field_preamble_field_reference_title',
  'field_preamble_field_text_processed',
] as const;

interface SearchHit {
  _id?: string;
  _source?: {
    url?: string[];
    field_abbreviation?: string[];
    field_short_title?: string[];
    field_long_title?: string[];
    field_full_quotation_processed?: string[];
    field_document_type_name?: string[];
    title?: string[];
  };
}

interface SearchResponse {
  hits?: {
    hits?: SearchHit[];
  };
}

function nodeId(id: string): string {
  return `entity:node/${id}:de`;
}

function currentStatusFilters(): object[] {
  const now = new Date();
  now.setUTCHours(12, 0, 0, 0);
  const timestamp = Math.floor(now.getTime() / 1000);

  return [
    { bool: { should: [{ range: { field_inforce_date: { lte: timestamp } } }, { bool: { must_not: { exists: { field: 'field_inforce_date' } } } }] } },
    { bool: { should: [{ range: { field_outforce_date: { gt: timestamp } } }, { bool: { must_not: { exists: { field: 'field_outforce_date' } } } }] } },
    { bool: { should: [{ term: { field_historically: { value: false } } }, { bool: { must_not: { exists: { field: 'field_historically' } } } }] } },
    { bool: { must_not: { range: { field_effective_from: { gt: timestamp } } } } },
  ];
}

function nrwSearchQuery(query: string): object {
  const wildcardAndMatchQueries = NRW_BODY_FIELDS.flatMap((field) => [
    { wildcard: { [field]: { value: `*${query}*`, boost: 1, case_insensitive: true } } },
    { match: { [field]: { query, operator: 'and', boost: 1, fuzziness: 1 } } },
  ]);
  const current = currentStatusFilters();

  return {
    function_score: {
      functions: [{ filter: { bool: { must: current } }, weight: 1.05 }],
      query: {
        bool: {
          must: [
            { terms: { type: ['state_law_and_regulations', 'state_law_ministerial_gazette'] } },
            {
              dis_max: {
                queries: [
                  { multi_match: { fields: NRW_TITLE_FIELDS, query, operator: 'and', boost: 50, type: 'phrase', slop: 0 } },
                  ...wildcardAndMatchQueries,
                ],
              },
            },
            { bool: { should: current } },
          ],
        },
      },
    },
  };
}

function extractAbbreviation(text: string): string {
  const parentheticals = [...text.matchAll(/\(([^()]+)\)/g)].map((match) => match[1]?.trim() ?? '');
  for (const parenthetical of parentheticals.reverse()) {
    const afterDash = parenthetical.split(/\s[-–]\s/).pop()?.trim() ?? parenthetical;
    if (/[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]*[A-ZÄÖÜ]/.test(afterDash) && afterDash.length <= 40) {
      return afterDash;
    }
  }
  return '';
}

function toSearchResult(result: RankableSearchResult): SearchResult {
  return {
    id: result.id,
    title: result.title,
    subtitle: result.subtitle,
    date: result.date,
  };
}

async function resolveUrl(id: string): Promise<string> {
  // Numeric ID → look up URL slug via OpenSearch
  if (/^\d+$/.test(id)) {
    const resp = await safeAxiosPost<SearchResponse>(axios, SEARCH, {
      query: { term: { _id: nodeId(id) } }, size: 1, _source: ['url'],
    }, LEGIS_NRW_POLICY);
    const url = resp.data.hits?.hits?.[0]?._source?.url?.[0];
    if (!url) throw new Error(`NW law not found: ${id}`);
    return url;
  }
  return `/lrgv/${id}`;
}

export class NRWAdapter implements LegisAdapter {
  readonly states = ['NW'] as const;

  async search(_state: string, query: string, limit: number): Promise<SearchResult[]> {
    const resp = await safeAxiosPost<SearchResponse>(axios, SEARCH, {
      query: nrwSearchQuery(query),
      size: NRW_SEARCH_FETCH_LIMIT,
      _source: [
        'url',
        'field_abbreviation',
        'field_short_title',
        'field_long_title',
        'field_full_quotation_processed',
        'field_document_type_name',
        'title',
      ],
    }, LEGIS_NRW_POLICY);

    const results = ((resp.data.hits?.hits || []) as SearchHit[]).map((h): RankableSearchResult => {
      const s = h._source ?? {};
      const nid = h._id?.match(/node\/(\d+)/)?.[1] || '';
      const longTitle = s.field_long_title?.[0] || s.title?.[0] || '';
      const shortTitle = s.field_short_title?.[0] || s.field_abbreviation?.[0] || extractAbbreviation(longTitle);
      const fullQuotation = s.field_full_quotation_processed?.[0] || '';
      return {
        id: nid,
        title: longTitle || shortTitle,
        subtitle: shortTitle,
        date: s.field_document_type_name?.[0] || '',
        rankText: `${shortTitle} ${longTitle} ${fullQuotation} ${s.url?.[0] ?? ''}`,
        isRootDocument: true,
      };
    });

    return rankSearchResults(results, query, limit).map(toSearchResult);
  }

  async get(_state: string, id: string): Promise<LegisEntry> {
    const path = await resolveUrl(id);
    const url = `${BASE}${path}`;
    const resp = await safeAxiosGet<string>(axios, url, LEGIS_NRW_POLICY, { maxRedirects: 5 });
    const $ = load(resp.data);

    const title = $('title').text().replace(/\s*\|\s*RECHT\.NRW\.DE$/, '').replace(/^\d{2}\.\d{2}\.\d{4}\s+/, '').trim();

    // Remove navigation, alerts, TOC, toolbars
    $('.alert, .footnote-container, .dropdown, .back-to-text-top, .print-title, nav, .toc-sidebar, .search-in-text, .toolbar').remove();

    const paragraphs = $('.paragraph--type--article');
    paragraphs.find('.paragraph-header a, .article-print').remove();
    paragraphs.first().find('table').remove(); // Inhaltsübersicht
    paragraphs.find('a[href^="/gvnrw"], a[href^="/lrgv"]').each((_, el) => { $(el).replaceWith($(el).text()); });
    paragraphs.find('h1 br, h2 br, h3 br, h4 br, h5 br').replaceWith(' ');

    const parts: string[] = [];
    paragraphs.each((_, el) => { parts.push($.html(el)); });
    const md = turndown.turndown(parts.join('\n'));
    return { title, content: md, url: resp.request?.res?.responseUrl || url };
  }

  async toc(_state: string, id: string): Promise<TocEntry[]> {
    const query = /^\d+$/.test(id)
      ? { term: { _id: nodeId(id) } }
      : { bool: { filter: [{ term: { url: `/lrgv/${id}` } }] } };
    const resp = await safeAxiosPost<{
      hits?: {
        hits?: Array<{
          _source?: {
            field_body_field_num?: string[];
            field_body_field_headline?: string[];
          };
        }>;
      };
    }>(axios, SEARCH, {
      query, size: 1, _source: ['field_body_field_num', 'field_body_field_headline'],
    }, LEGIS_NRW_POLICY);

    const hit = resp.data.hits?.hits?.[0]?._source;
    if (!hit) throw new Error(`Law not found: ${id}`);

    const nums: string[] = hit.field_body_field_num || [];
    const heads: string[] = hit.field_body_field_headline || [];
    return nums.map((num, i) => ({ depth: 1, num, title: heads[i] || '' }));
  }
}
