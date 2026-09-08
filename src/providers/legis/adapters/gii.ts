import { HTTP_USER_AGENT } from '../../../config.js';
import { giiGetLegislation } from '../../../shared/clients/gii.js';
import { xmlField, xmlItems } from '../../../shared/xml.js';
import type {
  LegisAdapter,
  LegisEnumerationPage,
  LegisEnumerationRequest,
  SearchResult,
  LegisEntry,
  TocEntry,
} from '../types.js';
import axios from 'axios';
import { load } from 'cheerio';
import { safeAxiosGet } from '../../../shared/network-policy.js';
import { LEGIS_GII_POLICY } from '../network-policy.js';

const BASE_URL = 'https://www.gesetze-im-internet.de';

/**
 * The published index of every federal law — 6.127 entries, ~1,3 MB.
 *
 * Unlike RII's, this listing carries no dates of any kind: an item is a title
 * and a link to the law's XML archive, nothing more. That is why enumeration
 * here reports `unfiltered` rather than `derived` — there is no stamp to
 * compare a `since` bound against, so the only way to learn that a law changed
 * is to fetch it and hash the result.
 */
const TOC_URL = `${BASE_URL}/gii-toc.xml`;

const TOC_TTL_MS = 60 * 60 * 1000;
const DEFAULT_ENUMERATION_LIMIT = 1_000;
const MAX_ENUMERATION_LIMIT = 5_000;

export interface GiiLaw {
  /** The slug GII uses in every URL for the law, e.g. `bgb`. */
  readonly id: string;
  readonly title: string;
}

/** `https://www.gesetze-im-internet.de/bgb/xml.zip` → `bgb`. */
function slugFromLink(link: string): string {
  return link.match(/\/([^/]+)\/xml\.zip\s*$/)?.[1] ?? '';
}

export function parseLawIndex(xml: string): GiiLaw[] {
  const laws: GiiLaw[] = [];
  for (const item of xmlItems(xml)) {
    const id = slugFromLink(xmlField(item, 'link'));
    if (!id) continue;
    laws.push({ id, title: xmlField(item, 'title') });
  }
  // Sorted by slug so a cursor is the last id emitted rather than an offset
  // into a listing that may be regenerated between pages.
  return laws.sort((a, b) => a.id.localeCompare(b.id));
}

// Depth by structural keyword
const STRUCT_DEPTH: Record<string, number> = {
  Buch: 0, Teil: 0,
  Abschnitt: 1, Kapitel: 1,
  Titel: 2, Untertitel: 2, Unterkapitel: 2,
};

export class GiiAdapter implements LegisAdapter {
  readonly states = ['BUND'] as const;

  private index?: { laws: readonly GiiLaw[]; fetchedAt: number };
  private indexInFlight?: Promise<readonly GiiLaw[]>;

  async search(_state: string, _query: string, _limit: number): Promise<SearchResult[]> {
    throw new Error(
      'BUND does not support search. Use legis_get with id "law/section" (e.g. "bgb/823").',
    );
  }

  /**
   * Walk the published law index.
   *
   * The unit is the law, not the section: the listing publishes one entry per
   * law, and expanding to sections during enumeration would mean fetching all
   * 6.127 archives just to find out what exists. Callers that want section
   * granularity compose the three calls — `enumerate` for the laws, `toc` for
   * a law's sections, `get("slug/§ 823")` for one section's text.
   *
   * `since` is accepted and ignored, and `origin` says so. Silently pretending
   * to filter would turn every run into a full sweep that the caller believed
   * was a delta.
   */
  async enumerate(_state: string, request: LegisEnumerationRequest = {}): Promise<LegisEnumerationPage> {
    const limit = Math.min(Math.max(1, request.limit ?? DEFAULT_ENUMERATION_LIMIT), MAX_ENUMERATION_LIMIT);
    const laws = await this.lawIndex();
    const start = request.cursor
      ? laws.findIndex((law) => law.id.localeCompare(request.cursor!) > 0)
      : 0;
    const page = start < 0 ? [] : laws.slice(start, start + limit);
    const last = page.at(-1);
    const exhausted = start < 0 || start + page.length >= laws.length;

    return {
      results: page.map((law): SearchResult => ({
        id: law.id,
        title: law.title,
        subtitle: law.id,
        date: '',
        url: `${BASE_URL}/${law.id}/index.html`,
      })),
      ...(exhausted || !last ? {} : { nextCursor: last.id }),
      origin: 'unfiltered',
    };
  }

  private async lawIndex(): Promise<readonly GiiLaw[]> {
    if (this.index && Date.now() - this.index.fetchedAt < TOC_TTL_MS) return this.index.laws;
    this.indexInFlight ??= (async () => {
      try {
        const response = await safeAxiosGet<string>(axios, TOC_URL, LEGIS_GII_POLICY, {
          responseType: 'text',
          headers: { 'User-Agent': HTTP_USER_AGENT },
        });
        const laws = parseLawIndex(response.data);
        this.index = { laws, fetchedAt: Date.now() };
        return laws;
      } finally {
        this.indexInFlight = undefined as unknown as Promise<readonly GiiLaw[]>;
      }
    })();
    return this.indexInFlight;
  }

  async get(_state: string, id: string): Promise<LegisEntry> {
    const slashIndex = id.indexOf('/');
    if (slashIndex === -1) {
      // A bare slug is a whole law, which is exactly what `enumerate` yields.
      // Returning its masthead and section list keeps every enumerated
      // reference fetchable; the section texts come from "slug/§ 823".
      return this.getLaw(id);
    }

    const law = id.substring(0, slashIndex);
    const section = id.substring(slashIndex + 1);
    const result = await giiGetLegislation(law, section);

    return {
      title: result.title,
      content: result.content,
      url: result.url,
    };
  }

  /**
   * A law's own index page: its title and the sections it contains.
   *
   * Not the full text — that lives in the per-section pages, and joining 2.400
   * of them for the BGB would produce a document no consumer asked for. This
   * is the document that actually exists at the law's canonical URL.
   */
  private async getLaw(slug: string): Promise<LegisEntry> {
    const law = slug.toLowerCase();
    // The published index is the authority on what a slug means, so a typo is
    // caught here rather than as a 404 three requests later. `bgb823` used to
    // produce a helpful error and must keep doing so now that a bare slug is
    // legitimate: the index tells the two cases apart, which no amount of
    // pattern-matching on the string could.
    const laws = await this.lawIndex().catch(() => undefined);
    if (!laws) {
      // Without the index a slug cannot be told from a typo, so fall back to
      // the older contract and demand the unambiguous form rather than
      // surfacing a transport error the caller cannot act on.
      throw new Error('BUND id must be "law/section" (e.g. "bgb/823", "gg/Art. 1")');
    }
    if (!laws.some((entry) => entry.id === law)) {
      const split = this.suggestSectionSplit(law, laws);
      throw new Error(
        `Unknown law "${slug}". A BUND id is either a law slug ("bgb") or law/section ("bgb/823")`
        + (split ? `. Did you mean "${split}"?` : '.'),
      );
    }

    const url = `${BASE_URL}/${law}/index.html`;
    const entries = await this.toc('BUND', slug);
    const response = await safeAxiosGet<ArrayBuffer>(axios, url, LEGIS_GII_POLICY, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const $ = load(Buffer.from(response.data).toString('latin1'));
    const title = $('#titel').text().replace(/\s+/g, ' ').trim()
      || $('title').text().replace(/\s+/g, ' ').trim()
      || slug;

    const content = [
      `# ${title}`,
      '',
      ...entries.map((entry) => `${'  '.repeat(Math.max(0, entry.depth - 1))}- ${[entry.num, entry.title].filter(Boolean).join(' ')}`),
    ].join('\n');

    return { title, content, url };
  }

  /**
   * `bgb823` → `bgb/823`: the longest known slug that prefixes the input, with
   * the remainder read as the section the caller meant to separate.
   */
  private suggestSectionSplit(slug: string, laws: readonly GiiLaw[]): string | undefined {
    let best: string | undefined;
    for (const law of laws) {
      if (slug.startsWith(law.id) && slug.length > law.id.length) {
        if (!best || law.id.length > best.length) best = law.id;
      }
    }
    return best ? `${best}/${slug.slice(best.length)}` : undefined;
  }

  async toc(_state: string, id: string): Promise<TocEntry[]> {
    const law = id.toLowerCase();
    const resp = await safeAxiosGet<ArrayBuffer>(axios, `${BASE_URL}/${law}/index.html`, LEGIS_GII_POLICY, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    const html = Buffer.from(resp.data).toString('latin1');
    const $ = load(html);

    const entries: TocEntry[] = [];
    let pendingStruct: string | null = null;
    let lastStructDepth = 0;

    $('#paddingLR12 a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2) return;

      if (href.includes('BJNG')) {
        const kwMatch = text.match(/\b(Buch|Abschnitt|Kapitel)\b/) || text.match(/\b(Titel|Untertitel|Unterkapitel)\b(?!.*nahme)/) || text.match(/\bTeil\b$/);
        const isRoman = /^[IVX]+\.?\s*$/.test(text);
        if (kwMatch || isRoman) {
          if (pendingStruct) {
            entries.push({ depth: lastStructDepth, num: '', title: pendingStruct });
          }
          pendingStruct = text;
        } else if (pendingStruct) {
          const kw = pendingStruct.match(/\b(Buch|Abschnitt|Kapitel|Titel|Untertitel|Unterkapitel)\b/);
          lastStructDepth = kw?.[1] ? (STRUCT_DEPTH[kw[1]] ?? 1) : 1;
          entries.push({ depth: lastStructDepth, num: pendingStruct, title: text });
          pendingStruct = null;
        } else {
          entries.push({ depth: lastStructDepth + 1, num: '', title: text });
        }
      } else if (href.includes('__') || href.includes('art_')) {
        if (pendingStruct) { pendingStruct = null; }
        const m = text.match(/^(§§?\s*\S+|Art\.?\s*\S+)\s+(.*)/);
        entries.push({ depth: 3, num: m?.[1] || text, title: m?.[2] || '' });
      }
    });

    return entries;
  }
}
