import { load } from 'cheerio';
import { createBaseTurndownService, postProcessMarkdown } from '../../../shared/converter.js';

const turndown = createBaseTurndownService();

// Randnummern: <div class="rd">12</div> → [Rn. 12]{.rn}
turndown.addRule('bayernRandnummer', {
  filter: (node) => node.nodeName === 'DIV' && node.classList.contains('rd'),
  replacement: (content) => {
    const num = content.trim();
    return num ? `\n\n[Rn. ${num}]{.rn} ` : '';
  },
});

export function convertBayernDecision(html: string): {
  title: string;
  court: string;
  date: string;
  fileNumber: string;
  leitsaetze: string[];
  normenketten: string[];
  fundstelle: string;
  content: string;
} {
  const $ = load(html);

  // Metadata from <title>: "AG München, Endurteil v. 09.04.2021 – 142 C 14251/20"
  const titleTag = $('title').text().replace(/\s*-\s*Bürgerservice.*/, '').trim();
  const titleMatch = titleTag.match(/^(.+?),\s*.+?\s+v\.\s*([\d.]+)\s*[–-]\s*(.+)$/);
  const court = titleMatch?.[1] || '';
  const date = titleMatch?.[2] || '';
  const fileNumber = titleMatch?.[3] || '';

  const title = $('h1.titelzeile').text().trim();
  const leitsaetze = $('.leitsatz').map((_, el) => $(el).text().trim()).get();

  // Collect rsprboxzeile items grouped by their preceding rsprboxueber header
  const normenketten: string[] = [];
  let inNormenketten = false;
  $('.rsprbox').children().each((_, el) => {
    const $el = $(el);
    if ($el.hasClass('rsprboxueber')) {
      inNormenketten = $el.text().includes('Normenketten');
    } else if ($el.hasClass('rsprboxzeile') && inNormenketten) {
      normenketten.push($el.text().trim());
    }
  });

  const fundstelle = (() => {
    let inFundstelle = false;
    let result = '';
    $('.rsprbox').children().each((_, el) => {
      const $el = $(el);
      if ($el.hasClass('rsprboxueber')) inFundstelle = $el.text().includes('Fundstelle');
      else if ($el.hasClass('rsprboxzeile') && inFundstelle) { result = $el.text().trim(); inFundstelle = false; }
    });
    return result;
  })();

  // Content: everything after rsprbox
  $('.rsprbox, .leerzeile, nav, header, footer, script, style').remove();
  const contentHtml = $('.cont').html() || $('body').html() || '';
  const content = postProcessMarkdown(turndown.turndown(contentHtml));

  return { title, court, date, fileNumber, leitsaetze, normenketten, fundstelle, content };
}
