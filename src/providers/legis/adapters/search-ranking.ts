import type { SearchResult } from '../types.js';

export interface RankableSearchResult extends SearchResult {
  readonly rankText?: string;
  readonly isRootDocument?: boolean;
}

const TOKEN_SPLIT = /\s+/;
const GERMAN_UMLAUTS: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
};
const QUERY_STOPWORDS = new Set([
  'bw', 'baden', 'wuerttemberg',
  'by', 'bayern', 'bay',
  'be', 'berlin',
  'bb', 'brandenburg',
  'hb', 'bremen', 'bremer',
  'hh', 'hamburg', 'hamburger',
  'he', 'hessen', 'hessisch', 'hessische', 'hessisches',
  'mv', 'mecklenburg', 'vorpommern',
  'ni', 'niedersachsen', 'niedersaechsisch', 'niedersaechsische', 'niedersaechsisches',
  'nw', 'nrw', 'nordrhein', 'westfalen',
  'rp', 'rlp', 'rheinland', 'pfalz',
  'sl', 'saarland', 'saarlaendisch', 'saarlaendische', 'saarlaendisches',
  'sn', 'sachsen', 'saechsisch', 'saechsische', 'saechsisches',
  'st', 'lsa', 'sachsen', 'anhalt',
  'sh', 'schleswig', 'holstein',
  'th', 'thueringen', 'thueringer',
]);

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => GERMAN_UMLAUTS[char] ?? char)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(TOKEN_SPLIT)
    .filter((token) => token.length > 1 && !QUERY_STOPWORDS.has(token));
}

function scoreField(field: string, query: string, queryTokens: string[], weight: number): number {
  const normalized = normalizeSearchText(field);
  if (!normalized) return 0;

  let score = 0;
  if (normalized === query) score += 1000 * weight;
  if (query && normalized.includes(query)) score += 350 * weight;

  const fieldTokens = new Set(normalized.split(TOKEN_SPLIT));
  const matched = queryTokens.filter((token) => (
    fieldTokens.has(token) || normalized.includes(token)
  ));
  if (matched.length === queryTokens.length && queryTokens.length > 0) score += 220 * weight;
  score += matched.length * 40 * weight;

  return score;
}

function isSectionTitle(title: string): boolean {
  return /^(§|art\.?|artikel)\s/i.test(title.trim());
}

export function rankSearchResults<T extends RankableSearchResult>(
  results: readonly T[],
  query: string,
  limit: number,
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokens(query);

  return [...results]
    .map((result, index) => {
      const title = result.title;
      const subtitle = result.subtitle;
      const rankText = result.rankText ?? `${title} ${subtitle} ${result.date}`;
      let relevance = 0;

      relevance += scoreField(subtitle, normalizedQuery, queryTokens, 4);
      relevance += scoreField(title, normalizedQuery, queryTokens, 3);
      relevance += scoreField(rankText, normalizedQuery, queryTokens, 1);

      let score = relevance;

      if (result.isRootDocument === true) score += 300;
      if (isSectionTitle(title)) score -= 450;
      if (queryTokens.length > 0 && queryTokens.every((token) => normalizeSearchText(rankText).includes(token))) score += 200;

      return { result, score, relevance, index };
    })
    .filter(({ relevance }) => relevance > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ result }) => result);
}
