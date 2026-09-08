import axios, { type AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { HTTP_USER_AGENT } from '../../../config.js';
import type { DecisionAdapter, DecisionEntry, DecisionPage, DecisionSearchResult } from '../types.js';
import { safeAxiosGet, safeAxiosPost } from '../../../shared/network-policy.js';
import { RII_SACHSEN_POLICY } from '../network-policy.js';

const URL = 'https://www.justiz.sachsen.de/esamosplus/pages/suchen.aspx';

/**
 * Two budgets, because the two requests behave nothing alike.
 *
 * The landing page is a static ASP.NET render that answered in 87–177ms across
 * repeated measurements, so 8s is already ~45x headroom; it was only ever
 * sharing the search timeout by accident.
 *
 * The search POST is the known-bad half — this adapter has recorded 504s from
 * it, and every measured attempt consumed its entire budget and returned
 * nothing. `CaseLawClient` fans all seventeen sources out concurrently, so
 * whatever this number is becomes the floor on total search latency for every
 * `rii_search`. At the previous 15s, Sachsen alone set that floor while
 * contributing nothing.
 *
 * 6s is a damage bound, not a measurement: there is no successful sample to
 * size against. It is deliberately still generous for a slow-but-working
 * endpoint, so a recovered upstream is not locked out by an over-tight limit.
 */
const LANDING_TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 6000;

const turndown = new TurndownService({ headingStyle: 'atx' });
type Http = Pick<AxiosInstance, 'get' | 'post'>;
type HitId = { query: string; name: string; value: string };
type SubmitResult = { html: string; fallback: boolean };
const encode = (hit: HitId) => Buffer.from(JSON.stringify(hit), 'utf8').toString('base64url');
const decode = (id: string): HitId => JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as HitId;

export class SachsenDecisionAdapter implements DecisionAdapter {
  readonly sources = ['SN'] as const;
  constructor(private readonly http: Http = axios) {}

  private formFields(html: string): URLSearchParams {
    const $ = cheerio.load(html); const form = new URLSearchParams();
    $('form#SlForm input, form#SlForm select').each((_, el) => {
      const name = $(el).attr('name'); const type = ($(el).attr('type') || '').toLowerCase();
      if (!name || type === 'submit' || type === 'button' || type === 'checkbox') return;
      if ($(el).is('select')) form.set(name, $(el).find('option[selected]').attr('value') || '-1');
      else form.set(name, $(el).attr('value') || '');
    });
    return form;
  }

  private async submit(query: string, extra?: { name: string; value: string }): Promise<SubmitResult> {
    // Named so the failure this surfaces through `failures[]` says which of the
    // two requests died. A bare "timeout of 15000ms exceeded" was ambiguous
    // between the landing page and the search, and the two mean very different
    // things: the former is the portal being down, the latter is business as
    // usual for this endpoint.
    let initial;
    try {
      initial = await safeAxiosGet<string>(this.http, URL, RII_SACHSEN_POLICY, {
        timeout: LANDING_TIMEOUT_MS,
        headers: { 'User-Agent': HTTP_USER_AGENT },
      });
    } catch (error) {
      throw new Error(
        `Sachsen landing page did not load within ${LANDING_TIMEOUT_MS}ms `
        + `(${error instanceof Error ? error.message : String(error)})`,
        { cause: error },
      );
    }
    // The landing page already contains the current decisions. Posting an empty
    // search can produce an empty result page on the live WebForms endpoint.
    if (!extra && query.trim() === '') return { html: initial.data, fallback: true };
    const form = this.formFields(initial.data);
    form.set('DV1_C33', 'Oberlandesgericht Dresden'); form.set('DV1_C34', ''); form.set('DV1_C35', ''); form.set('DV1_C36', ''); form.set('DV1_C37', query); form.set('DV1_C38', '-1'); form.set('DV1_C39', '-1'); form.set('DV1_C48', 'on');
    if (extra) { form.set(extra.name, extra.value); } else { form.set('DV1_C24', 'Suchen'); }
    const setCookie = initial.headers?.['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie.map((value: string) => value.split(';', 1)[0]).join('; ') : undefined;
    try {
      const response = await safeAxiosPost<string>(this.http, URL, form.toString(), RII_SACHSEN_POLICY, {
        timeout: SEARCH_TIMEOUT_MS,
        headers: { 'User-Agent': HTTP_USER_AGENT, Referer: URL, 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) },
      });
      return { html: response.data, fallback: false };
    } catch {
      return { html: initial.data, fallback: true };
    }
  }

  async search(_source: string, query: string, limit: number): Promise<DecisionSearchResult[]> {
    return (await this.searchPage(_source, query, limit)).results;
  }

  /**
   * First page only. The result grid is an ASP.NET WebForms control driven by
   * `__doPostBack` targets that are only rendered once a search has succeeded,
   * and the upstream search endpoint has been answering 504 — so a pager
   * cannot be confirmed, let alone relied on.
   */
  async searchPage(_source: string, query: string, limit: number, page = 1): Promise<DecisionPage> {
    if (page > 1) return { results: [], pagingUnsupported: true };
    const submitted = await this.submit(query);
    const $ = cheerio.load(submitted.html);
    const needle = query.toLocaleLowerCase('de-DE');
    const results = $('#DV16_Table tbody tr').map((_, row) => {
      const cells = $(row).find('td'); const date = cells.eq(1).text().replace(/\s+/g, ' ').trim(); const fileNumber = cells.eq(2).text().replace(/\s+/g, ' ').trim(); const court = cells.eq(3).text().replace(/\s+/g, ' ').trim();
      const button = cells.eq(4).find('input[type="submit"]'); const name = button.attr('name') || ''; const value = button.attr('value') || ''; const snippet = cells.eq(2).find('[title]').attr('title')?.replace(/^Leitsatz:\s*/i, '') || '';
      return { id: encode({ query, name, value }), title: `${court} - ${fileNumber}`, subtitle: snippet, snippet, date, court, fileNumber };
    }).get().filter((result) => result.id.length > 10 && (!submitted.fallback || `${result.title} ${result.subtitle}`.toLocaleLowerCase('de-DE').includes(needle))).slice(0, limit);
    return { results };
  }

  async get(_source: string, id: string): Promise<DecisionEntry> {
    const hit = decode(id); const submitted = await this.submit(hit.query, hit); const $ = cheerio.load(submitted.html);
    const title = $('h1').first().text().replace(/\s+/g, ' ').trim() || $('title').text().trim(); $('script, style, form, nav').remove();
    const root = $('#DV1_C40, main, body').first(); const bodyText = $('body').text().replace(/\s+/g, ' ');
    return { title, content: turndown.turndown(root.html() || ''), url: URL, court: bodyText.match(/Oberlandesgericht Dresden|Landgericht Dresden/)?.[0] || 'Sachsen', date: bodyText.match(/\b\d{2}\.\d{2}\.\d{4}\b/)?.[0] || '', fileNumber: hit.value };
  }
}
