import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { risHtmlToMarkdown } from './converter.js';
import { validateConversion } from '../../shared/converter.js';

/** Real OGH Rechtssatz document HTML captured from ris.bka.gv.at. */
const html = readFileSync(
  fileURLToPath(new URL('./__fixtures__/judikatur-document.html', import.meta.url)),
  'utf8',
);

describe('risHtmlToMarkdown — real RIS document HTML', () => {
  const markdown = risHtmlToMarkdown(html);

  it('produces non-trivial Markdown', () => {
    expect(markdown.length).toBeGreaterThan(200);
  });

  it('preserves the key legal fields (court, Rechtssatznummer, norms, Rechtssatz text)', () => {
    expect(markdown).toContain('OGH');
    expect(markdown).toContain('RS0106668');
    expect(markdown).toContain('Norm');
    expect(markdown).toContain('Rechtssatz');
    expect(markdown).toContain('Werknutzung');
  });

  it('passes validateConversion (no false layout-change alarm)', () => {
    expect(() => validateConversion(markdown, 'RIS (Austria)')).not.toThrow();
  });
});

describe('risHtmlToMarkdown — Randnummern (real OGH decision)', () => {
  const decisionHtml = readFileSync(
    fileURLToPath(new URL('./__fixtures__/judikatur-decision.html', import.meta.url)),
    'utf8',
  );
  const markdown = risHtmlToMarkdown(decisionHtml);

  it('rewrites leading [N] paragraph markers into pandoc [Rn. N]{.rn} spans', () => {
    expect(markdown).toContain('[Rn. 1]{.rn}');
    expect(markdown).toContain('[Rn. 19]{.rn}');
    const spans = [...markdown.matchAll(/\[Rn\. \d+\]\{\.rn\}/g)];
    expect(spans.length).toBeGreaterThanOrEqual(19);
  });
});

describe('risHtmlToMarkdown — screen-reader duplicate removal', () => {
  it('drops .sr-only siblings so § markers are not doubled', () => {
    const html =
      '<html><body><p class="ParagraphMitAbsatz">' +
      '<span aria-hidden="true">§ 1</span><span class="sr-only">Paragraph 1</span>' +
      ' Der Vertrag ist gültig und bindend für beide Parteien nach Treu und Glauben.' +
      '</p></body></html>';
    const md = risHtmlToMarkdown(html);
    expect(md).toContain('§ 1');
    expect(md).not.toContain('Paragraph 1');
  });
});
