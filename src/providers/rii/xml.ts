import { decodeXmlEntities, xmlElementContent } from '../../shared/xml.js';

/**
 * Parser for `rii-dok.dtd`, the format RII publishes each decision in.
 *
 * This is a different route into the same document than the portal HTML the
 * search path scrapes, and a markedly better one: the archive carries the ECLI,
 * the decision type, the deciding chamber, the norms the court applied and the
 * prior instances — all as tagged fields rather than as prose to be recovered
 * with regular expressions. The body keeps its section boundaries and its
 * Randnummern, which the rendered page flattens.
 */

export interface RiiXmlDocument {
  readonly docNumber: string;
  readonly ecli?: string;
  readonly court: string;
  readonly courtLocation?: string;
  readonly chamber?: string;
  readonly decisionDate: string;
  readonly fileNumber: string;
  readonly documentType?: string;
  /** Norms the court applied, as published: `§ 8 Abs 2 Nr 1 MarkenG`. */
  readonly citedNorms: readonly string[];
  /** Prior instances, as published prose: `vorgehend BPatG München, …`. */
  readonly priorInstances: readonly string[];
  readonly headnotes: readonly string[];
  readonly title: string;
  readonly markdown: string;
}

/** Ordered as a reader expects them, not as the DTD happens to list them. */
const BODY_SECTIONS: readonly (readonly [tag: string, heading: string])[] = [
  ['tenor', 'Tenor'],
  ['tatbestand', 'Tatbestand'],
  ['entscheidungsgruende', 'Entscheidungsgründe'],
  ['gruende', 'Gründe'],
  ['abwmeinung', 'Abweichende Meinung'],
  ['sonstlt', 'Sonstiges'],
];

function textOf(xml: string, tag: string): string {
  const raw = xmlElementContent(xml, tag);
  return raw === undefined ? '' : stripTags(raw);
}

function stripTags(fragment: string): string {
  return decodeXmlEntities(
    fragment
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** `20231012` → `2023-10-12`. */
function isoDate(compact: string): string {
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : compact;
}

/**
 * Render a section, turning the definition list the DTD uses for numbered
 * paragraphs into the same `[Rn. N]{.rn}` marker the HTML converter emits — so
 * a consumer cannot tell which route produced a document.
 */
function renderSection(fragment: string): string {
  const paragraphs: string[] = [];
  const pattern = /<dt>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g;
  let match: RegExpExecArray | null;
  let consumed = false;
  while ((match = pattern.exec(fragment))) {
    consumed = true;
    const number = stripTags(match[1] ?? '');
    const body = stripTags(match[2] ?? '');
    if (!body) continue;
    paragraphs.push(number ? `[Rn. ${number}]{.rn} ${body}` : body);
  }
  // Tenor and Leitsatz carry no Randnummern; they are plain paragraphs.
  if (!consumed) {
    const text = stripTags(fragment);
    return text ? text : '';
  }
  return paragraphs.join('\n\n');
}

function listOf(xml: string, tag: string, separator: RegExp): string[] {
  const raw = xmlElementContent(xml, tag);
  if (raw === undefined) return [];
  return stripTags(raw)
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function parseRiiDocument(xml: string): RiiXmlDocument {
  const court = textOf(xml, 'gertyp');
  const chamber = textOf(xml, 'spruchkoerper');
  const courtLocation = textOf(xml, 'gerort');
  const fileNumber = textOf(xml, 'aktenzeichen');
  const decisionDate = isoDate(textOf(xml, 'entsch-datum'));
  const documentType = textOf(xml, 'doktyp');

  const headnotes = [
    ...listOf(xml, 'leitsatz', /\n{2,}/),
    ...listOf(xml, 'sonstosatz', /\n{2,}/),
  ];

  const sections: string[] = [];
  const titleLine = textOf(xml, 'titelzeile');
  if (titleLine) sections.push(`# ${titleLine}`);
  if (headnotes.length > 0) {
    sections.push(`## Leitsatz\n\n${headnotes.join('\n\n')}`);
  }
  for (const [tag, heading] of BODY_SECTIONS) {
    const fragment = xmlElementContent(xml, tag);
    if (fragment === undefined) continue;
    const rendered = renderSection(fragment);
    if (rendered) sections.push(`## ${heading}\n\n${rendered}`);
  }

  const title = titleLine
    || [court && chamber ? `${court} ${chamber}` : court, fileNumber].filter(Boolean).join(' | ')
    || textOf(xml, 'doknr');

  return {
    docNumber: textOf(xml, 'doknr'),
    ...(textOf(xml, 'ecli') ? { ecli: textOf(xml, 'ecli') } : {}),
    court,
    ...(courtLocation ? { courtLocation } : {}),
    ...(chamber ? { chamber } : {}),
    decisionDate,
    fileNumber,
    ...(documentType ? { documentType } : {}),
    // Published as one comma-separated string. Splitting on commas that are
    // followed by a paragraph or article marker keeps `§ 8 Abs 2 Nr 1 MarkenG`
    // whole instead of shattering it at every internal comma.
    citedNorms: listOf(xml, 'norm', /,\s*(?=(?:§+|Art\.?|Artikel)\s)/),
    priorInstances: listOf(xml, 'vorinstanz', /\n+/),
    headnotes,
    title,
    markdown: sections.join('\n\n'),
  };
}
