import TurndownService from 'turndown';
import { load } from 'cheerio';

const turndown = new TurndownService({ headingStyle: 'atx' });

// Strip citation reference links like [1, 2]
turndown.addRule('citationRef', {
  filter: (node) => node.nodeName === 'CITE',
  replacement: (content) => content,
});

export function htmlToMarkdown(html: string): string {
  const $ = load(html);
  // Strip nav, TOC, header, footer, scripts, styles
  $('nav, header, footer, script, style, .ltx_page_navbar, .ltx_page_header, .ltx_page_footer, .package-alerts').remove();
  const body = $('.ltx_page_content').html() || $('body').html() || '';
  return turndown.turndown(body).trim();
}
