import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { jportalDecisionSearch, jportalGetDocument, JPORTAL_STATES, type JPortalDecisionPage, type JPortalSearchResult } from '../../../shared/clients/jportal.js';
import type { DecisionAdapter, DecisionEntry, DecisionPage, DecisionSearchResult } from '../types.js';

interface DecisionClient {
  search(state: string, query: string, limit: number, start?: number): Promise<JPortalDecisionPage>;
  get(state: string, id: string): Promise<{ title: string; head: string; text: string; permalink: string }>;
}

const turndown = new TurndownService({ headingStyle: 'atx' });

function result(r: JPortalSearchResult): DecisionSearchResult {
  return {
    id: r.docId,
    title: r.title,
    subtitle: r.subtitle,
    date: r.date,
    ...(r.court ? { court: r.court } : {}),
    ...(r.fileNumber ? { fileNumber: r.fileNumber } : {}),
    ...(r.snippet ? { snippet: r.snippet } : {}),
  };
}

function metadata(head: string): Record<string, string> {
  const $ = cheerio.load(head);
  const values: Record<string, string> = {};
  $('th').each((_, el) => {
    const key = $(el).text().trim().replace(/:$/, '').toLowerCase();
    const value = $(el).next('td').text().trim();
    if (key && value) values[key] = value;
  });
  return values;
}

export class JPortalDecisionAdapter implements DecisionAdapter {
  readonly sources = JPORTAL_STATES;

  constructor(private readonly client: DecisionClient = { search: jportalDecisionSearch, get: jportalGetDocument }) {}

  async search(source: string, query: string, limit: number): Promise<DecisionSearchResult[]> {
    return (await this.searchPage(source, query, limit)).results;
  }

  async searchPage(source: string, query: string, limit: number, page = 1): Promise<DecisionPage> {
    // The R3 API takes a 1-based absolute offset, not a page number.
    const fetched = await this.client.search(source, query, limit, (page - 1) * limit + 1);
    return {
      results: fetched.results.map(result),
      ...(fetched.totalHits === undefined ? {} : { totalHits: fetched.totalHits }),
    };
  }

  async get(source: string, id: string): Promise<DecisionEntry> {
    const doc = await this.client.get(source, id);
    const meta = metadata(doc.head);
    const $ = cheerio.load(doc.text);
    $('script, style, nav, header, footer, .docLayoutNavigation').remove();
    const content = turndown.turndown($.html() || '');
    return {
      title: doc.title,
      content,
      url: doc.permalink,
      court: meta.gericht || '',
      date: meta.datum || meta['entscheidungsdatum'] || '',
      fileNumber: meta.aktenzeichen || '',
      ...(meta.ecli ? { ecli: meta.ecli } : {}),
    };
  }
}
