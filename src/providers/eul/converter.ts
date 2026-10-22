import TurndownService from 'turndown';

export class EulConverter {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({ headingStyle: 'atx' });
    // Full documents carry a <head>; its title and stylesheet text are not content.
    this.turndown.remove(['title', 'style', 'script']);

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

    // Annex titles in the Official Journal XHTML: the first <p class="oj-doc-ti">
    // of an annex container (id "anx_…") is "ANHANG III", the next one its
    // title. Keyed on the container, not on the word, so it holds in every
    // language. Annexes sit at the top level, like chapters.
    this.turndown.addRule('annexTitle', {
      filter: (node) => node.nodeName === 'P'
        && hasClass(node, 'oj-doc-ti')
        && (node.parentElement?.getAttribute('id') ?? '').startsWith('anx_'),
      replacement: (content, node) => {
        const first = node.parentElement?.querySelector('p.oj-doc-ti') === node;
        return `\n\n${first ? '#' : '##'} ${content.trim()}\n\n`;
      },
    });

    // Consolidated-text XHTML uses its own class names for the same structure.
    const consolidatedHeadings: Record<string, string> = {
      'title-division-1': '#',
      'title-division-2': '##',
      'title-article-norm': '##',
      'stitle-article-norm': '###',
      'title-annex-1': '#',
      'title-annex-2': '##',
    };
    this.turndown.addRule('consolidatedHeading', {
      filter: (node) => node.nodeName === 'P'
        && Object.keys(consolidatedHeadings).some((name) => hasClass(node, name)),
      replacement: (content, node) => {
        const element = node as HTMLElement;
        const name = Object.keys(consolidatedHeadings).find((candidate) => hasClass(element, candidate));
        // Some consolidations tag an annex's title like the annex number
        // itself; a second annex-1 line in a row is the title.
        const repeatedAnnex = name === 'title-annex-1'
          && element.previousElementSibling !== null
          && hasClass(element.previousElementSibling as HTMLElement, 'title-annex-1');
        const level = repeatedAnnex ? '##' : consolidatedHeadings[name ?? ''] ?? '##';
        return `\n\n${level} ${content.trim()}\n\n`;
      },
    });

    // Pre-2014 EUR-Lex HTML has no classes at all: an article title is a bare
    // paragraph reading "Artikel 5". Only an exact, unclassed match qualifies.
    this.turndown.addRule('plainArticleTitle', {
      filter: (node) => node.nodeName === 'P'
        && !node.getAttribute('class')
        && /^(?:Artikel|Article|Articolo|Artículo|Artigo|Artykuł)\s+\d+[a-z]?$/i.test(node.textContent?.trim() ?? ''),
      replacement: (content) => `\n\n## ${content.trim()}\n\n`,
    });

    // Likewise "KAPITEL III" or "ABSCHNITT 2" as a bare paragraph: a division
    // title, at the top level like its OJ and consolidated counterparts.
    this.turndown.addRule('plainDivisionTitle', {
      filter: (node) => node.nodeName === 'P'
        && !node.getAttribute('class')
        && /^(?:TEIL|TITEL|KAPITEL|ABSCHNITT|PART|TITLE|CHAPTER|SECTION|PARTIE|TITRE|CHAPITRE)\s+(?:[IVXLC]+|\d{1,3})$/i
          .test(node.textContent?.trim() ?? ''),
      replacement: (content) => `\n\n# ${content.trim()}\n\n`,
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

function hasClass(node: HTMLElement, name: string): boolean {
  return (node.getAttribute('class') ?? '').split(/\s+/).includes(name);
}
