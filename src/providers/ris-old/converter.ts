import TurndownService from 'turndown';
import * as cheerio from 'cheerio';

export class RisConverter {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });

    this.configureTurndown();
  }

  private configureTurndown() {
    // LegalDocML uses akn: namespace, handle common elements
    this.turndown.addRule('aknMarker', {
      filter: (node) => node.nodeName.toLowerCase().startsWith('akn:'),
      replacement: (content) => content,
    });

    // Handle internal links
    this.turndown.addRule('internalLinks', {
      filter: 'a',
      replacement: (content, node) => {
        const element = node as HTMLAnchorElement;
        let href = element.getAttribute('href');

        if (!href || href === 'null') {
          return content;
        }

        if (href.startsWith('/')) {
          href = 'https://testphase.rechtsinformationen.bund.de' + href;
        }

        return `[${content}](${href})`;
      },
    });

    // Strip hidden/metadata elements
    this.turndown.addRule('hiddenText', {
      filter: (node) => {
        const element = node as HTMLElement;
        return element.style?.display === 'none' || element.hidden;
      },
      replacement: () => '',
    });
  }

  convertToMarkdown(html: string): string {
    const $ = cheerio.load(html);

    // Remove script and style tags
    $('script, style').remove();

    // Clean up the HTML
    const cleanHtml = $.html();

    return this.turndown.turndown(cleanHtml);
  }

  extractMetadata(json: Record<string, unknown>): Record<string, string> {
    // Extract common metadata fields from RIS JSON responses
    const metadata = json as Record<string, unknown>;
    const court = metadata.court as Record<string, unknown> | undefined;
    
    return {
      title: String(metadata.title || metadata.shortTitle || ''),
      type: String(metadata.documentType || metadata.type || ''),
      date: String(metadata.decisionDate || metadata.publicationDate || metadata.date || ''),
      court: court?.name ? String(court.name) : '',
      fileNumber: String(metadata.fileNumber || ''),
      ecli: String(metadata.ecli || ''),
      eli: String(metadata.eli || ''),
    };
  }

  generateOutline(json: Record<string, unknown>, htmlPreview: string): string {
    const metadata = this.extractMetadata(json);
    const preview = this.convertToMarkdown(htmlPreview).slice(0, 500);

    let outline = `# ${metadata.title}\n\n`;
    outline += `**Type:** ${metadata.type}\n`;
    if (metadata.date) outline += `**Date:** ${metadata.date}\n`;
    if (metadata.court) outline += `**Court:** ${metadata.court}\n`;
    if (metadata.fileNumber) outline += `**File Number:** ${metadata.fileNumber}\n`;
    if (metadata.ecli) outline += `**ECLI:** ${metadata.ecli}\n`;
    if (metadata.eli) outline += `**ELI:** ${metadata.eli}\n`;
    outline += `\n## Preview\n\n${preview}...\n`;

    return outline;
  }

  extractSection(html: string, section: string): string | null {
    const $ = cheerio.load(html);

    // Try to find section by heading text (fuzzy match)
    const headings = $('h1, h2, h3, h4, h5, h6');
    for (const heading of headings.toArray()) {
      const text = $(heading).text().trim();
      if (text.toLowerCase().includes(section.toLowerCase())) {
        // Extract content until next heading of same or higher level
        const level = parseInt(heading.tagName[1]);
        let content = $(heading).prop('outerHTML') || '';
        let next = $(heading).next();

        while (next.length > 0) {
          const nextTag = next.prop('tagName')?.toLowerCase();
          if (nextTag?.match(/^h[1-6]$/)) {
            const nextLevel = parseInt(nextTag[1]);
            if (nextLevel <= level) break;
          }
          content += next.prop('outerHTML') || '';
          next = next.next();
        }

        return this.convertToMarkdown(content);
      }
    }

    // Try article/paragraph markers (§)
    if (section.match(/§?\s*\d+/)) {
      const articleNum = section.replace(/[§\s]/g, '');
      const article = $(`[data-article="${articleNum}"], #article-${articleNum}, .article-${articleNum}`);
      if (article.length > 0) {
        return this.convertToMarkdown(article.html() || '');
      }
    }

    return null;
  }
}
