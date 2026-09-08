import { describe, it, expect } from 'vitest';
import { parseToc } from './toc.js';

/** Mirrors the real RIS Inhaltsverzeichnis table structure. */
const html =
  '<html><body><table>' +
  '<tr><td><p class="InhaltEintrag"><span aria-hidden="true"><span class="Kursiv">§ 1.</span></span>' +
  '<span class="sr-only">Paragraph eins,</span></p></td>' +
  '<td><p class="InhaltEintrag"><span class="Kursiv">Begriff des bürgerlichen Rechtes.</span></p></td></tr>' +
  '<tr><td colspan="2"><p class="InhaltEintrag">Von den Personen.</p></td></tr>' +
  '<tr><td><p class="InhaltEintrag">§ 3. bis § 5.</p></td>' +
  '<td><p class="InhaltEintrag">Anfang der Wirksamkeit.</p></td></tr>' +
  '<tr><td><p class="InhaltEintrag">§ 16.</p></td>' +
  '<td><p class="InhaltEintrag">Angeborne Rechte.</p></td></tr>' +
  '</table></body></html>';

describe('parseToc', () => {
  it('parses § → heading pairs (start of a §-range) and skips section dividers', () => {
    expect(parseToc(html)).toEqual([
      { paragraph: '1', heading: 'Begriff des bürgerlichen Rechtes' },
      { paragraph: '3', heading: 'Anfang der Wirksamkeit' },
      { paragraph: '16', heading: 'Angeborne Rechte' },
    ]);
  });

  it('drops the screen-reader "Paragraph N" duplicate from the § cell', () => {
    expect(parseToc(html)[0]?.heading).not.toContain('Paragraph eins');
  });

  it('returns an empty list when there is no Inhaltsverzeichnis', () => {
    expect(parseToc('<html><body><p>no toc here</p></body></html>')).toEqual([]);
  });

  it('matches a paragraph suffix regardless of case', () => {
    const upper =
      '<table><tr><td><p class="InhaltEintrag">§ 1A.</p></td>' +
      '<td><p class="InhaltEintrag">Sonderfall.</p></td></tr></table>';
    expect(parseToc(upper)).toEqual([{ paragraph: '1A', heading: 'Sonderfall' }]);
  });
});

describe('parseToc — body-heading laws (StGB-style)', () => {
  const html =
    '<html><body>' +
    '<h4 class="UeberschrPara AlignCenter">Mord</h4>' +
    '<h5 class="GldSymbol"><span aria-hidden="true">§ 75.</span><span class="sr-only">Paragraph 75,</span></h5>' +
    '<p class="Abs">Wer einen anderen tötet …</p>' +
    '<h4 class="UeberschrPara">Totschlag</h4>' +
    '<h5 class="GldSymbol">§ 76.</h5>' +
    '</body></html>';

  it('pairs each § (.GldSymbol) with its preceding .UeberschrPara heading', () => {
    expect(parseToc(html)).toEqual([
      { paragraph: '75', heading: 'Mord' },
      { paragraph: '76', heading: 'Totschlag' },
    ]);
  });
});
