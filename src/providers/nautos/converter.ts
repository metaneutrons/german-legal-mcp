import { load } from 'cheerio';
import TurndownService from 'turndown';

const td = new TurndownService({ headingStyle: 'atx' });

// Strip viewer-internal anchors (<a id="de:...">)
td.addRule('stripAnchors', {
  filter: (node) => node.nodeName === 'A' && !!(node.getAttribute('id') || '').match(/^de:/),
  replacement: () => '',
});

// Notes → blockquotes with bold label
td.addRule('note', {
  filter: (node) => node.nodeName === 'DIV' && (node.getAttribute('class') || '').includes('tr--note'),
  replacement: (_content, node) => {
    const $ = load((node as unknown as { outerHTML: string }).outerHTML);
    const label = $('.tr--non-normative-note-label').text().trim();
    const body = $('.tr--note .tr--p').map((_, el) => $(el).text().trim()).get();
    if (label && body.length) {
      body[0] = (body[0] ?? '').replace(label, '').trim();
      return `\n\n> **${label}** ${body.join('\n> ')}\n\n`;
    }
    return `\n\n> ${body.join('\n> ')}\n\n`;
  },
});

// Section labels (clause numbers) in headings — keep inline
td.addRule('label', {
  filter: (node) => node.nodeName === 'SPAN' && (node.getAttribute('class') || '').includes('tr--label')
    && !!(node.parentNode && (node.parentNode as HTMLElement).tagName?.match(/^H[1-6]$/i)),
  replacement: (content) => `${content.trim()} `,
});

// List items with label spans
td.addRule('listItem', {
  filter: (node) => node.nodeName === 'DIV' && (node.getAttribute('class') || '').includes('tr--li'),
  replacement: (content, node) => {
    const $ = load((node as unknown as { outerHTML: string }).outerHTML);
    const label = $('.tr--label').first().text().trim();
    const body = content.replace(label, '').trim();
    return `\n- ${label} ${body}`;
  },
});

// Table captions
td.addRule('caption', {
  filter: (node) => node.nodeName === 'DIV' && (node.getAttribute('class') || '').includes('tr--caption'),
  replacement: (content) => `\n\n**${content.trim()}**\n\n`,
});

export function htmlToMarkdown(html: string): string {
  // Pre-process: strip DOCTYPE and xmlns
  const clean = html
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/\s+xmlns="[^"]*"/g, '');
  return td.turndown(clean).replace(/\n{3,}/g, '\n\n').trim();
}
