import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import {
  jportalSearch,
  jportalGetDocument,
  JPORTAL_STATES,
  type JPortalSearchResult,
} from '../../../shared/clients/jportal.js';
import type { LegisAdapter, SearchResult, LegisEntry } from '../types.js';
import { rankSearchResults, type RankableSearchResult } from './search-ranking.js';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
const JPORTAL_SECTION_SUFFIX = /NN\d{8,12}$/;
const SEARCH_EXPANSION_FACTOR = 20;
const MAX_SEARCH_RESULTS_TO_RERANK = 200;

function extractMetadata(headHtml: string): string {
  const $ = cheerio.load(headHtml);
  const pairs: string[] = [];
  $('th').each((_, th) => {
    const key = $(th).text().trim().replace(/:$/, '');
    const val = $(th).next('td').text().trim();
    if (key && val) pairs.push(`**${key}:** ${val}`);
  });
  return pairs.join('  \n');
}

function rootDocId(docId: string): string {
  return docId.replace(JPORTAL_SECTION_SUFFIX, '');
}

function isRootDocument(docId: string): boolean {
  return rootDocId(docId) === docId;
}

function extractRootTitle(result: JPortalSearchResult): string {
  if (isRootDocument(result.docId)) return result.title;

  const parts = result.subtitle.split('|').map((part) => part.trim()).filter(Boolean);
  const lawTitle = parts.find((part) => (
    !part.startsWith('-') &&
    !part.startsWith('gültig') &&
    !part.startsWith('Landesnorm') &&
    /(?:gesetz|verordnung|satzung|ordnung|gesetzbuch|staatsvertrag|bekanntmachung)/i.test(part)
  ));

  return lawTitle ?? result.title;
}

function toRankableResult(result: JPortalSearchResult): RankableSearchResult {
  const root = rootDocId(result.docId);
  const title = extractRootTitle(result);
  const isRoot = isRootDocument(result.docId);

  return {
    id: root,
    title,
    subtitle: isRoot ? result.subtitle : `${result.title} | ${result.subtitle}`,
    date: result.date,
    rankText: `${title} ${result.title} ${result.subtitle}`,
    isRootDocument: isRoot,
  };
}

function dedupeById(results: readonly RankableSearchResult[]): RankableSearchResult[] {
  const deduped = new Map<string, RankableSearchResult>();
  for (const result of results) {
    const existing = deduped.get(result.id);
    if (!existing || (result.isRootDocument === true && existing.isRootDocument !== true)) {
      deduped.set(result.id, result);
    }
  }
  return [...deduped.values()];
}

function toSearchResult(result: RankableSearchResult): SearchResult {
  return {
    id: result.id,
    title: result.title,
    subtitle: result.subtitle,
    date: result.date,
  };
}

export class JPortalAdapter implements LegisAdapter {
  readonly states = JPORTAL_STATES;

  async search(state: string, query: string, limit: number): Promise<SearchResult[]> {
    const expandedLimit = Math.min(MAX_SEARCH_RESULTS_TO_RERANK, Math.max(limit, limit * SEARCH_EXPANSION_FACTOR));
    const results = await jportalSearch(state, query, expandedLimit);
    return rankSearchResults(dedupeById(results.map(toRankableResult)), query, limit).map(toSearchResult);
  }

  async get(state: string, id: string): Promise<LegisEntry> {
    const doc = await jportalGetDocument(state, id);

    const metadata = extractMetadata(doc.head);
    const $ = cheerio.load(doc.text);
    // Remove internal navigation anchors and empty tags
    $('a[name]').not('[href]').remove();
    $('comment, .docLayoutNavigation').remove();
    $('h1 br, h2 br, h3 br, h4 br').replaceWith(' ');
    const content = turndown.turndown($.html() || '');

    return {
      title: doc.title,
      content: metadata ? `${metadata}\n\n---\n\n${content}` : content,
      url: doc.permalink,
    };
  }
}
