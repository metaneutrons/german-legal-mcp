import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

export class GiiConverter {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
  }

  extractLegislation(html: string): {
    title: string;
    section: string;
    content: string;
    prev: string | null;
    next: string | null;
  } {
    const $ = cheerio.load(html);

    // Extract title and section
    const lawTitle = $('.jnheader h1')
      .contents()
      .filter(function () {
        return this.type === 'text';
      })
      .text()
      .trim();
    const section = $('.jnenbez').text().trim();
    const sectionTitle = $('.jnentitel').text().trim();

    // Extract content
    const contentHtml = $('.jnhtml').html() || '';
    const content = this.turndown.turndown(contentHtml);

    // Extract navigation
    const prevHref = $('a[href*="__"][title*="vorherigen"]').attr('href');
    const nextHref = $('a[href*="__"][title*="nachfolgenden"]').attr('href');

    return {
      title: `${lawTitle}\n${section} ${sectionTitle}`,
      section,
      content,
      prev: prevHref || null,
      next: nextHref || null,
    };
  }
}
