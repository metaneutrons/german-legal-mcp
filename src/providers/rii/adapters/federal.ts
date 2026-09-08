import axios, { type AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { HTTP_USER_AGENT } from '../../../config.js';
import { validateConversion } from '../../../shared/converter.js';
import { xmlField, xmlItems } from '../../../shared/xml.js';
import { readFirstZipEntry, ZIP_MAX_ARCHIVE_BYTES } from '../../../shared/zip.js';
import { parseRiiDocument } from '../xml.js';
import { RiiConverter } from '../converter.js';
import type { DecisionAdapter, DecisionEnumerationPage, DecisionEnumerationRequest, DecisionEntry, DecisionGetOptions, DecisionPage, DecisionSearchResult } from '../types.js';
import { safeAxiosGet } from '../../../shared/network-policy.js';
import { RII_FEDERAL_POLICY } from '../network-policy.js';

const BASE_URL = 'https://www.rechtsprechung-im-internet.de/jportal/portal/page/bsjrsprod.psml';

/**
 * The published table of contents — every decision the portal holds, in one
 * ~23 MB XML document.
 *
 * This is a different route into the same site than `search`, and the only one
 * that can enumerate: the search mask is a stateful Jetspeed portlet that
 * serves page one only, and the portal itself refuses to page beyond 3.000
 * hits, so no sequence of queries reaches the whole corpus.
 */
const TOC_URL = 'https://www.rechtsprechung-im-internet.de/rii-toc.xml';

/** Where the table of contents points: one ZIP per decision, holding its XML. */
const DOCS_URL = 'https://www.rechtsprechung-im-internet.de/jportal/docs/bsjrs';

/**
 * How long one download is reused across the paged calls of a single walk.
 *
 * A walk of 83.785 entries takes many pages; refetching 23 MB per page would
 * be absurd, and a snapshot that shifted mid-walk would make cursors lie.
 */
const TOC_TTL_MS = 60 * 60 * 1000;

const DEFAULT_ENUMERATION_LIMIT = 1_000;
const MAX_ENUMERATION_LIMIT = 5_000;

interface TocEntry {
  readonly id: string;
  readonly court: string;
  readonly decisionDate: string;
  readonly fileNumber: string;
  readonly modified: string;
}

/** `20100108` in the feed; `2010-01-08` everywhere downstream. */
function isoDate(compact: string): string {
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : compact;
}

/**
 * The document id the rest of the adapter already speaks.
 *
 * The feed links to `.../jb-JURE100054597.zip`, and the portal's own result
 * rows carry `doc.id=jb-KORE607392026` — prefix included. Stripping `jb-` here
 * would produce references that `get` cannot resolve.
 */
function documentIdFromLink(link: string): string {
  return link.match(/\/([^/]+)\.zip\s*$/)?.[1] ?? '';
}

export function parseTableOfContents(xml: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const item of xmlItems(xml)) {
    const id = documentIdFromLink(xmlField(item, 'link'));
    if (!id) continue;
    entries.push({
      id,
      court: xmlField(item, 'gericht'),
      decisionDate: isoDate(xmlField(item, 'entsch-datum')),
      fileNumber: xmlField(item, 'aktenzeichen'),
      modified: xmlField(item, 'modified'),
    });
  }
  // Sorted by id so a cursor is "the last id emitted" rather than an offset
  // into a snapshot. An offset would skip or repeat entries whenever the feed
  // is regenerated between pages.
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The result count, taken from the `numberofresults` field the result-list form
 * carries on every page.
 *
 * Deliberately not the visible "N Treffer" text: the page also renders
 * "Das Blättern ans Ende der Trefferliste ist bei mehr als 3.000 Treffern nicht
 * möglich", so a naive scrape of the first number followed by "Treffer" reports
 * that 3.000 threshold as the total — 3.000 where the true figure was 6.296.
 */
export function parseFederalTotalHits(html: string): number | undefined {
  const match = html.match(/name="numberofresults"\s+value="(\d+)"/)
    ?? html.match(/numberofresults=(\d+)/);
  if (!match?.[1]) return undefined;
  const total = Number.parseInt(match[1], 10);
  return Number.isNaN(total) ? undefined : total;
}

export class FederalDecisionAdapter implements DecisionAdapter {
  readonly sources = ['BUND'] as const;

  private toc?: { entries: readonly TocEntry[]; fetchedAt: number };
  private tocInFlight?: Promise<readonly TocEntry[]>;

  constructor(private readonly http: Pick<AxiosInstance, 'get'> = axios, private readonly converter: RiiConverter = new RiiConverter()) {}

  /**
   * Walk the published table of contents.
   *
   * `origin` is `derived`, not `native`: the feed is one static document with
   * no server-side filtering, so `since` is applied here after downloading it.
   * Exact, but every walk pays for the whole 23 MB listing once.
   *
   * `modified` is the feed's own stamp and is a hint, not a guarantee — its
   * values currently cluster at a single date, which is the signature of a
   * site-wide regeneration. A caller must still compare content hashes rather
   * than trust that a changed stamp means changed text.
   */
  async enumerate(_source: string, request: DecisionEnumerationRequest = {}): Promise<DecisionEnumerationPage> {
    const limit = Math.min(Math.max(1, request.limit ?? DEFAULT_ENUMERATION_LIMIT), MAX_ENUMERATION_LIMIT);
    const entries = await this.tableOfContents();
    const matching = request.since
      ? entries.filter((entry) => entry.modified >= request.since!)
      : entries;
    const start = request.cursor
      ? matching.findIndex((entry) => entry.id.localeCompare(request.cursor!) > 0)
      : 0;
    const page = start < 0 ? [] : matching.slice(start, start + limit);
    const last = page.at(-1);
    const exhausted = start < 0 || start + page.length >= matching.length;

    return {
      results: page.map((entry): DecisionSearchResult => ({
        id: entry.id,
        // The feed carries no title. A citation-shaped label is the honest
        // stand-in; `get` replaces it with the decision's own once fetched.
        title: [entry.court, entry.fileNumber].filter(Boolean).join(' | ') || entry.id,
        subtitle: entry.decisionDate,
        date: entry.decisionDate,
        ...(entry.court ? { court: entry.court } : {}),
        ...(entry.fileNumber ? { fileNumber: entry.fileNumber } : {}),
        url: `${BASE_URL}?doc.id=${entry.id}`,
      })),
      ...(exhausted || !last ? {} : { nextCursor: last.id }),
      origin: 'derived',
    };
  }

  private async getFromArchive(id: string): Promise<DecisionEntry | undefined> {
    try {
      const response = await safeAxiosGet<ArrayBuffer>(this.http, `${DOCS_URL}/${id}.zip`, RII_FEDERAL_POLICY, {
        headers: { 'User-Agent': HTTP_USER_AGENT },
        responseType: 'arraybuffer',
        timeout: 30_000,
        maxContentLength: ZIP_MAX_ARCHIVE_BYTES,
      });
      const entry = readFirstZipEntry(Buffer.from(response.data));
      const document = parseRiiDocument(entry.data.toString('utf8'));
      if (!document.markdown) return undefined;
      return {
        title: document.title,
        content: document.markdown,
        url: `${BASE_URL}?doc.id=${id}`,
        court: [document.court, document.chamber].filter(Boolean).join(' '),
        date: document.decisionDate,
        fileNumber: document.fileNumber,
        ...(document.ecli ? { ecli: document.ecli } : {}),
        ...(document.headnotes.length > 0 ? { headnotes: [...document.headnotes] } : {}),
        ...(document.citedNorms.length > 0 ? { norms: [...document.citedNorms] } : {}),
        ...(document.chamber ? { chamber: document.chamber } : {}),
        ...(document.documentType ? { documentType: document.documentType } : {}),
        ...(document.priorInstances.length > 0
          ? { priorInstances: [...document.priorInstances] }
          : {}),
      };
    } catch {
      // No archive for this id, or an unreadable one. The rendered page is
      // still there, so this is a fallback rather than a failure.
      return undefined;
    }
  }

  /**
   * One download per TTL, and one in flight at a time — concurrent pages at
   * the start of a walk would otherwise each pull their own 23 MB copy.
   */
  private async tableOfContents(): Promise<readonly TocEntry[]> {
    if (this.toc && Date.now() - this.toc.fetchedAt < TOC_TTL_MS) return this.toc.entries;
    this.tocInFlight ??= (async () => {
      try {
        const response = await safeAxiosGet<string>(this.http, TOC_URL, RII_FEDERAL_POLICY, {
          headers: { 'User-Agent': HTTP_USER_AGENT },
          responseType: 'text',
          timeout: 60_000,
          maxContentLength: 64 * 1024 * 1024,
        });
        const entries = parseTableOfContents(response.data);
        this.toc = { entries, fetchedAt: Date.now() };
        return entries;
      } finally {
        this.tocInFlight = undefined as unknown as Promise<readonly TocEntry[]>;
      }
    })();
    return this.tocInFlight;
  }

  async search(_source: string, query: string, limit: number): Promise<DecisionSearchResult[]> {
    return (await this.searchPage(_source, query, limit)).results;
  }

  /**
   * First page only.
   *
   * Paging here is a stateful Jetspeed portlet: the "weiter" control submits
   * `resultListForm` with `eventSubmit_doSkipforward`, and the server keeps the
   * result set against a portal navigation context that appears in the URL as a
   * `/t/<token>/` segment. A stateless search request never enters that context
   * — replaying the form against a fresh session returns an empty search mask,
   * verified against the live site with a matching JSESSIONID — so a page-two
   * request is reported as unsupported instead of silently re-serving page one.
   */
  async searchPage(_source: string, query: string, limit: number, page = 1): Promise<DecisionPage> {
    if (page > 1) return { results: [], pagingUnsupported: true };
    const response = await safeAxiosGet<string>(this.http, `${BASE_URL}/js_peid/Suchportlet2/media-type/html`, RII_FEDERAL_POLICY, {
      params: { formhaschangedvalue: 'yes', eventSubmit_doSearch: 'suchen', action: 'portlets.jw.MainAction', form: 'jurisExpertSearch', desc: 'text', query },
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = cheerio.load(response.data);
    const results = $('a.TrefferlisteHervorheben[id^="tlid"]').toArray().filter((el) => !$(el).attr('id')?.includes('.')).slice(0, limit).map((el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      const id = href.match(/doc\.id=([^&]+)/)?.[1] || '';
      const row = link.closest('tr');

      // The link's `title` attribute is only the hit's ordinal — "1. Treffer
      // Langtext" — so it was previously the whole title, leaving every BUND
      // row without court, date, file number or a usable label. The row itself
      // carries all of it: date in the leading cell, court in <strong>,
      // file number after the pipe, decision type in <em>.
      const date = row.children('td').first().text().trim();
      const court = link.find('strong').first().text().trim();
      // The row is two lines separated by <br>: "court | file number" then
      // "type | summary". `.text()` erases that break, so splitting on the tag
      // is what keeps the decision type out of the file number.
      const firstLine = (link.find('span').first().html() ?? '').split(/<br\s*\/?>/i)[0] ?? '';
      const headingText = cheerio.load(`<div>${firstLine}</div>`)('div').text()
        .replace(/\s+/g, ' ').trim();
      const fileNumber = court && headingText.startsWith(court)
        ? headingText.slice(court.length).replace(/^\s*\|\s*/, '').trim()
        : '';
      const decisionType = link.find('em').first().text().trim();
      const summary = link.find('strong').last().text().replace(/\s+/g, ' ').trim();

      return {
        id,
        // Preference order: the court's own summary sentence, then the decision
        // type, then "court | file number". The link's `title` attribute is last
        // because on a real result page it is only the hit's ordinal
        // ("1. Treffer Langtext"); it is retained solely so a stripped-down or
        // changed layout still yields something rather than an empty cell.
        title: (summary && summary !== court ? summary : '')
          || decisionType || headingText || link.attr('title') || link.text().trim(),
        subtitle: [decisionType, court, fileNumber].filter(Boolean).join(' | '),
        date,
        ...(court ? { court } : {}),
        ...(fileNumber ? { fileNumber } : {}),
        snippet: row.find('.docPreview').text().replace(/\s+/g, ' ').trim(),
        url: `${BASE_URL}?doc.id=${id}`,
      };
    }).filter((r) => r.id);
    const totalHits = parseFederalTotalHits(response.data);
    return { results, ...(totalHits === undefined ? {} : { totalHits }) };
  }

  /**
   * The published XML archive first, the rendered page only if that fails.
   *
   * The archive is the same document by a better road: it carries the ECLI, the
   * decision type, the chamber, the norms the court applied and the prior
   * instances as tagged fields, and keeps the section boundaries and
   * Randnummern that the page flattens. It is also one request against a static
   * file with a published DTD, rather than a scrape of a portlet whose paging
   * is already known to be unreliable.
   *
   * The HTML path stays as the fallback because the archive is not guaranteed
   * to exist for every id — a decision published today may not be in the
   * distribution yet.
   */
  async get(_source: string, id: string, options: DecisionGetOptions = {}): Promise<DecisionEntry> {
    if (!options.part || options.part === 'L') {
      const fromArchive = await this.getFromArchive(id);
      if (fromArchive) return fromArchive;
    }
    const response = await safeAxiosGet<string>(this.http, BASE_URL, RII_FEDERAL_POLICY, {
      params: { 'doc.id': id, 'doc.part': options.part || 'L', showdoccase: '1', paramfromHL: 'true' },
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const d = this.converter.extractDecision(response.data);
    validateConversion(d.content, 'Rechtsprechung im Internet');
    return { title: d.title, content: d.content, url: `${BASE_URL}?doc.id=${id}`, court: d.court, date: d.date, fileNumber: d.fileNumber, ...(d.ecli ? { ecli: d.ecli } : {}) };
  }
}
