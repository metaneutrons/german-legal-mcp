import type { DecisionAdapter, DecisionEntry, DecisionPage, DecisionSearchResult } from '../types.js';
import { searchBayern, fetchBayernDecision } from '../bayern/client.js';
import { convertBayernDecision } from '../bayern/converter.js';

interface BayernClient { search(query: string, limit: number, page?: number): Promise<{ results: Array<{ title: string; docId: string; subtitle: string }>; totalHits?: number }>; get(id: string): Promise<string>; }

/**
 * Bayern splits decision metadata over the two lines of a result: the heading
 * is `court: subject` and the subtitle is `type vom date – fileNumber`, as in
 * `OLG Bamberg: Schadensersatz` over `Urteil vom 01.08.2023 – 5 U 351/21`.
 *
 * None of it was read. Search results carried no court, no file number, and a
 * date hardcoded to the empty string — which also kept BY out of the date
 * tie-break that orders equally-scored hits, so its rows sorted arbitrarily.
 *
 * Sampled 32 decision hits across four queries: 32 of 32 headings had the
 * colon and 32 of 32 subtitles matched the metadata line.
 *
 * The subtitle is parsed first and gates the heading split. A subtitle that
 * reads like a decision is what makes the leading `X:` trustworthy as a court;
 * legislation on the same result page carries `Rechtsstand: <date>` instead and
 * must not have its heading carved up. The separator is an en dash on the live
 * site, with the hyphen accepted in case that is ever normalized. The file
 * number is taken as the whole remainder rather than pattern-matched, because
 * the forms vary widely — `125 O 1155/24`, `Verg 5/23 e`, `M 5 K 18.994`.
 */
export function parseBayernResult(title: string, subtitle: string): {
  court?: string;
  date?: string;
  fileNumber?: string;
  title: string;
} {
  const metadata = subtitle.match(/\bvom\s+(\d{2}\.\d{2}\.\d{4})\s*[–—-]\s*(\S.*)$/);
  if (!metadata) return { title };

  const [, date, fileNumber] = metadata;
  const parsed: { court?: string; date?: string; fileNumber?: string; title: string } = { title };
  if (date) parsed.date = date;
  if (fileNumber?.trim()) parsed.fileNumber = fileNumber.trim();

  // Bounded and colon-free so a colon deep inside a long subject cannot be
  // mistaken for the court delimiter.
  const heading = title.match(/^([^:]{2,60}):\s+(\S.*)$/);
  if (heading) {
    const [, court, subject] = heading;
    if (court?.trim()) parsed.court = court.trim();
    if (subject?.trim()) parsed.title = subject.trim();
  }
  return parsed;
}

export class BayernDecisionAdapter implements DecisionAdapter {
  readonly sources = ['BY'] as const;

  constructor(private readonly client: BayernClient = { search: searchBayern, get: fetchBayernDecision }) {}

  async search(_source: string, query: string, limit: number): Promise<DecisionSearchResult[]> {
    return (await this.searchPage(_source, query, limit)).results;
  }

  async searchPage(_source: string, query: string, limit: number, page = 1): Promise<DecisionPage> {
    const fetched = await this.client.search(query, limit, page);
    return {
      results: fetched.results.map((r) => {
        const parsed = parseBayernResult(r.title, r.subtitle);
        return {
          id: r.docId,
          title: parsed.title,
          subtitle: r.subtitle,
          date: parsed.date ?? '',
          ...(parsed.court ? { court: parsed.court } : {}),
          ...(parsed.fileNumber ? { fileNumber: parsed.fileNumber } : {}),
        };
      }),
      ...(fetched.totalHits === undefined ? {} : { totalHits: fetched.totalHits }),
    };
  }

  async get(_source: string, id: string): Promise<DecisionEntry> {
    const d = convertBayernDecision(await this.client.get(id));
    const content = [d.leitsaetze.length ? `## Leitsätze\n\n${d.leitsaetze.map((l, i) => `${i + 1}. ${l}`).join('\n')}` : '', d.normenketten.length ? `**Normenketten:** ${d.normenketten.join('; ')}` : '', d.fundstelle ? `**Fundstelle:** ${d.fundstelle}` : '', d.content].filter(Boolean).join('\n\n');
    return { title: d.title || d.fileNumber, content, url: `https://www.gesetze-bayern.de/Content/Document/${id}`, court: d.court, date: d.date, fileNumber: d.fileNumber };
  }
}
