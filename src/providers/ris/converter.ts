import * as cheerio from 'cheerio';
import { createBaseTurndownService, postProcessMarkdown } from '../../shared/converter.js';

/**
 * Convert a RIS document HTML page to pandoc-compatible Markdown.
 *
 * RIS document HTML (the `…/Dokumente/{App}/{ID}/{ID}.html` files) is the bare
 * document, not a portal shell, so whole-body conversion is reasonable.
 */
export function risHtmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);
  // Drop screen-reader-only duplicates: RIS renders each "§ N" with a hidden
  // "Paragraph N" sibling (and similar), which otherwise doubles every marker
  // and bloats consolidated statutes (~92 KB → ~61 KB of Markdown for the ABGB).
  $('script, style, head, nav, footer, .sr-only').remove();
  const body = $('body');
  const source = (body.length ? body.html() : $.root().html()) ?? '';
  const markdown = createBaseTurndownService().turndown(source);
  return markRandnummern(postProcessMarkdown(markdown));
}

/**
 * RIS Judikatur decisions prefix each paragraph with a Randnummer like `[1]`
 * (which Turndown escapes to `\[1\]`). Rewrite the leading marker into a pandoc
 * `[Rn. N]{.rn}` span so callers can pull a single Randnummer surgically via
 * `ris_get section="Rn 5"`, matching the rii/icu convention.
 */
function markRandnummern(markdown: string): string {
  return markdown.replace(/^[ \t]*\\?\[(\d+)\\?\]\s+/gm, '[Rn. $1]{.rn} ');
}
