import axios, { type AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { HTTP_USER_AGENT } from '../../../config.js';
import type { DecisionAdapter, DecisionEntry, DecisionPage, DecisionSearchResult } from '../types.js';
import type { Element } from 'domhandler';
import { safeAxiosGet, safeAxiosPost } from '../../../shared/network-policy.js';
import { RII_NRW_DOCUMENT_POLICY, RII_NRW_SEARCH_POLICY } from '../network-policy.js';

const BASE = 'https://nrwesuche.justiz.nrw.de';

/** NRW states its total in a dedicated element: "Es wurden <strong>20790</strong> Dokumente ... gefunden." */
export function parseNrwTotalHits(html: string): number | undefined {
  const text = cheerio.load(html)('#anzahlGefunden').text();
  const match = text.match(/([\d.]+)/);
  if (!match?.[1]) return undefined;
  const total = Number.parseInt(match[1].replace(/\./g, ''), 10);
  return Number.isNaN(total) ? undefined : total;
}
const turndown = new TurndownService({ headingStyle: 'atx' });

interface NrwHit { url: string; title: string; court: string; kind: string; fileNumber: string; ecli: string; date: string; norms: string; headnotes: string; }

const NRW_HIT_LABELS = [
  'Gericht',
  'Entscheidungsart',
  'Aktenzeichen',
  'ECLI',
  'Entscheidungsdatum',
  'Normen',
  'Leitsätze',
] as const;
type NrwHitLabel = typeof NRW_HIT_LABELS[number];

function hitValue(text: string, label: NrwHitLabel): string {
  const marker = `${label}:`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return '';
  const valueStart = markerIndex + marker.length;
  const nextMarker = NRW_HIT_LABELS
    .filter((candidate) => candidate !== label)
    .map((candidate) => text.indexOf(`${candidate}:`, valueStart))
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), text.length);
  const value = text.slice(valueStart, nextMarker).trim();
  return label === 'ECLI' && value ? `ECLI:${value}` : value;
}

function parseHit(el: Element, $: cheerio.CheerioAPI): NrwHit {
  const node = $(el);
  const text = node.text().replace(/\s+/g, ' ').trim();
  return {
    url: node.find('a').attr('href') || '',
    title: node.find('a').text().trim(),
    court: hitValue(text, 'Gericht'),
    kind: hitValue(text, 'Entscheidungsart'),
    fileNumber: hitValue(text, 'Aktenzeichen'),
    ecli: hitValue(text, 'ECLI'),
    date: hitValue(text, 'Entscheidungsdatum'),
    norms: hitValue(text, 'Normen'),
    headnotes: hitValue(text, 'Leitsätze'),
  };
}

function toResult(hit: NrwHit): DecisionSearchResult {
  return { id: hit.url, title: hit.title, subtitle: `${hit.court}${hit.fileNumber ? `, ${hit.fileNumber}` : ''}`, date: hit.date, court: hit.court, fileNumber: hit.fileNumber, ...(hit.ecli ? { ecli: hit.ecli } : {}), url: hit.url };
}

export class NRWDecisionAdapter implements DecisionAdapter {
  readonly sources = ['NW'] as const;

  constructor(private readonly http: Pick<AxiosInstance, 'get' | 'post'> = axios) {}

  async search(_source: string, query: string, limit: number): Promise<DecisionSearchResult[]> {
    return (await this.searchPage(_source, query, limit)).results;
  }

  async searchPage(_source: string, query: string, limit: number, page = 1): Promise<DecisionPage> {
    const params = new URLSearchParams({
      q: query, method: 'stem', qSize: String(limit), sortieren_nach: 'relevanz', advanced_search: 'false',
      absenden: 'Suchen', gerichtstyp: '', gerichtsbarkeit: '', gerichtsort: '', entscheidungsart: '', date: '',
      aktenzeichen: '', schlagwoerter: '', von: '', bis: '', validFrom: '', von2: '', bis2: '',
    });
    // The pager is a row of submit buttons named page1..pageN; naming one picks
    // that page.
    if (page > 1) params.set(`page${page}`, String(page));
    const response = await safeAxiosPost<string>(this.http, `${BASE}/index.php`, params.toString(), RII_NRW_SEARCH_POLICY, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = cheerio.load(response.data);
    const results = $('.einErgebnis').slice(0, limit).map((_, el) => toResult(parseHit(el, $))).get();
    const totalHits = parseNrwTotalHits(response.data);
    return { results, ...(totalHits === undefined ? {} : { totalHits }) };
  }

  async get(_source: string, id: string): Promise<DecisionEntry> {
    const response = await safeAxiosGet<string>(this.http, id, RII_NRW_DOCUMENT_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = cheerio.load(response.data);
    const fields: Record<string, string> = {};
    $('.feldbezeichnung').each((_, el) => { fields[$(el).text().trim().replace(/:$/, '').toLowerCase()] = $(el).next('.feldinhalt').text().trim(); });
    $('.screen, script, style, nav, #nrwelogo, #nrwelogo2').remove();
    const body = $('#enclosingDiv').nextAll('.maindiv').toArray().map((el) => $.html(el)).join('\n');
    return {
      title: $('#nrwetitle').text().replace(/\s+/g, ' ').trim(), content: turndown.turndown(body), url: id,
      court: fields.gericht || '', date: fields.datum || '', fileNumber: fields.aktenzeichen || '', ...(fields.ecli ? { ecli: fields.ecli } : {}),
    };
  }
}
