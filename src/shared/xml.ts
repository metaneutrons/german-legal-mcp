/**
 * Minimal XML text decoding for the flat listing feeds the providers walk.
 *
 * The bulk indexes are simple enough that a full parser would cost more than
 * it returns: `rii-toc.xml` is 83.785 flat `<item>` elements and `gii-toc.xml`
 * 6.127, both with fixed child order. What they do need is correct text
 * decoding — GII carries 247 `&quot;` in its law titles, and `&amp;` is not
 * optional in any XML that has to express a literal `&`.
 *
 * Numeric references are handled because the format permits them and ignoring
 * one silently corrupts a title rather than failing loudly.
 */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    // Last, so a doubly-encoded `&amp;lt;` does not become `<`.
    .replace(/&amp;/g, '&');
}

const XML_TAG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

function openingTagEnd(fragment: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start; index < fragment.length; index += 1) {
    const character = fragment[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    } else if (character === '<') {
      return -1;
    }
  }
  return -1;
}

/**
 * Return the first matching element body without compiling runtime text as a
 * regular expression. Tags are XML names, and opening-tag attributes are
 * accepted for the RII decision DTD.
 */
export function xmlElementContent(fragment: string, tag: string): string | undefined {
  if (!XML_TAG_NAME_PATTERN.test(tag)) throw new TypeError('Invalid XML tag name');
  const openingPrefix = `<${tag}`;
  const closingTag = `</${tag}>`;
  let searchFrom = 0;
  while (searchFrom < fragment.length) {
    const openingStart = fragment.indexOf(openingPrefix, searchFrom);
    if (openingStart < 0) return undefined;
    const boundary = fragment[openingStart + openingPrefix.length];
    if (boundary !== '>' && !/\s/.test(boundary ?? '')) {
      searchFrom = openingStart + openingPrefix.length;
      continue;
    }
    const contentStart = openingTagEnd(fragment, openingStart + openingPrefix.length);
    if (contentStart < 0) return undefined;
    const closingStart = fragment.indexOf(closingTag, contentStart + 1);
    if (closingStart < 0) return undefined;
    return fragment.slice(contentStart + 1, closingStart);
  }
  return undefined;
}

/**
 * Pull the text of the first `<tag>` inside a fragment.
 *
 * Returns an empty string when absent, which the callers treat as "field not
 * published" rather than as an error — the RII DTD marks three of its five
 * children optional.
 */
export function xmlField(fragment: string, tag: string): string {
  return decodeXmlEntities(xmlElementContent(fragment, tag)?.trim() ?? '');
}

/** Iterate the `<item>` fragments of a flat listing feed. */
export function xmlItems(xml: string): string[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1] ?? '');
}
