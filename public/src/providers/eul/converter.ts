import TurndownService from 'turndown';

export class EulConverter {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({ headingStyle: 'atx' });

    // ELI article titles: <p class="oj-ti-art"> → ## Artikel N
    this.turndown.addRule('articleTitle', {
      filter: (node) => node.nodeName === 'P' && node.getAttribute('class') === 'oj-ti-art',
      replacement: (content) => `\n\n## ${content.trim()}\n\n`,
    });

    // ELI article subtitles: <p class="oj-sti-art"> → ### Subtitle
    this.turndown.addRule('articleSubtitle', {
      filter: (node) => node.nodeName === 'P' && node.getAttribute('class') === 'oj-sti-art',
      replacement: (content) => `### ${content.trim()}\n\n`,
    });

    // Section headings: oj-ti-section-1, oj-ti-section-2
    this.turndown.addRule('sectionTitle', {
      filter: (node) => {
        const cls = node.getAttribute('class') || '';
        return node.nodeName === 'P' && cls.startsWith('oj-ti-section-');
      },
      replacement: (content, node) => {
        const cls = (node as HTMLElement).getAttribute('class') || '';
        const level = cls.includes('section-1') ? '#' : '##';
        return `\n\n${level} ${content.trim()}\n\n`;
      },
    });

    // Footnote markers: <span class="oj-super oj-note-tag">
    this.turndown.addRule('footnoteTag', {
      filter: (node) => (node.getAttribute('class') || '').includes('oj-note-tag'),
      replacement: (content) => `[^${content.trim()}]`,
    });
  }

  convert(html: string): string {
    return this.turndown.turndown(html);
  }
}
