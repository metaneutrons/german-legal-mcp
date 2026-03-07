import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

export class RiiConverter {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });

    // Format Randnummern: <a name="rd_5">5</a> -> [Rn. 5]{.rn}
    this.turndown.addRule('randnummer', {
      filter: (node) =>
        node.nodeName === 'A' &&
        (node.getAttribute('name') || '').startsWith('rd_'),
      replacement: (_content, node) => {
        const name = (node as HTMLElement).getAttribute('name') || '';
        const num = name.replace('rd_', '');
        return `\n\n[Rn. ${num}]{.rn} `;
      },
    });
  }

  extractDecision(html: string): {
    title: string;
    court: string;
    date: string;
    fileNumber: string;
    ecli: string;
    documentType: string;
    content: string;
  } {
    const $ = cheerio.load(html);

    // Extract metadata from table with strong labels
    const getMeta = (label: string): string => {
      const strong = $(`strong:contains("${label}")`);
      return strong.closest('td').next('td').text().trim();
    };

    const court = getMeta('Gericht:');
    const date = getMeta('Entscheidungsdatum:');
    const fileNumber = getMeta('Aktenzeichen:');
    const ecli = getMeta('ECLI:');
    const documentType = getMeta('Dokumenttyp:');

    // Extract title from docLayoutTitel
    const title = $('.docLayoutTitel').text().trim();

    // Extract content from docLayoutText
    const contentHtml = $('.docLayoutText').html() || '';
    const content = this.turndown.turndown(contentHtml);

    return {
      title,
      court,
      date,
      fileNumber,
      ecli,
      documentType,
      content,
    };
  }
}
