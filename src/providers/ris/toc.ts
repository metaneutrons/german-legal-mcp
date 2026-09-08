import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export interface RisTocEntry {
  /** Paragraph number, e.g. "1", "1295", "1a". For a §-range this is the start. */
  paragraph: string;
  heading: string;
}

/**
 * Parse the table of contents of a RIS whole-law ("Gesamte Rechtsvorschrift")
 * HTML page. RIS uses two structures, so both are handled:
 *   1. an Inhaltsverzeichnis table (`.InhaltEintrag` cells alternating § / heading),
 *      e.g. the ABGB; and
 *   2. body headings, where each § number sits in a `.GldSymbol` preceded by its
 *      heading in a `.UeberschrPara`, e.g. the StGB.
 */
export function parseToc(html: string): RisTocEntry[] {
  const $ = cheerio.load(html);
  $('.sr-only').remove();
  const fromTable = parseInhaltEintrag($);
  return fromTable.length > 0 ? fromTable : parseBodyHeadings($);
}

function parseInhaltEintrag($: CheerioAPI): RisTocEntry[] {
  const cells = $('.InhaltEintrag')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean);

  const entries: RisTocEntry[] = [];
  let current: RisTocEntry | null = null;
  for (const cell of cells) {
    const m = cell.match(/^§+\s*(\d+[a-z]?)/i);
    if (m) {
      current = { paragraph: m[1] ?? '', heading: '' };
      entries.push(current);
    } else if (current && !current.heading) {
      current.heading = cell.replace(/\.\s*$/, '');
    }
  }
  return entries;
}

function parseBodyHeadings($: CheerioAPI): RisTocEntry[] {
  const entries: RisTocEntry[] = [];
  let heading = '';
  $('.UeberschrPara, .GldSymbol').each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if ($el.hasClass('GldSymbol')) {
      const m = text.match(/§+\s*(\d+[a-z]?)/i);
      if (m) {
        entries.push({ paragraph: m[1] ?? '', heading });
        heading = '';
      }
    } else {
      heading = text.replace(/\.\s*$/, '');
    }
  });
  return entries;
}
