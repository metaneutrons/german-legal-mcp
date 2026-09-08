import TurndownService from 'turndown';

export class IcuConverter {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });

    // Randnummern: <A NAME="point5">5</A> -> [Rn. 5]{.rn}
    this.turndown.addRule('randnummer', {
      filter: (node) =>
        node.nodeName === 'A' &&
        (node.getAttribute('name') || '').startsWith('point'),
      replacement: (_content, node) => {
        const name = (node as HTMLElement).getAttribute('name') || '';
        const num = name.replace('point', '');
        return `\n\n[Rn. ${num}]{.rn} `;
      },
    });

    // Footnote refs: <A HREF="#Footnote*" NAME="Footref*">*</A>
    this.turndown.addRule('footnoteRef', {
      filter: (node) =>
        node.nodeName === 'A' &&
        (node.getAttribute('name') || '').startsWith('Footref'),
      replacement: (content) => `[^${content}]`,
    });

    // Footnote defs: <A HREF="#Footref*" NAME="Footnote*">*</A>
    this.turndown.addRule('footnoteDef', {
      filter: (node) =>
        node.nodeName === 'A' &&
        (node.getAttribute('name') || '').startsWith('Footnote'),
      replacement: (content) => `[^${content}]: `,
    });
  }

  convert(html: string): string {
    return this.turndown.turndown(html);
  }
}
