import { describe, expect, it } from 'vitest';
import { parseFederalTotalHits } from './federal.js';
import { parseNrwTotalHits } from './nrw.js';
import { parseNiedersachsenTotalHits } from './niedersachsen.js';
import { parseBayernTotalHits } from '../bayern/client.js';

/**
 * Markup fragments copied from live responses. Each source states its total
 * differently, and two of them state something that merely looks like a total.
 */
describe('per-source hit totals', () => {
  it('reads the federal count from numberofresults, not the visible Treffer text', () => {
    // The live page carries BOTH: a tooltip about a 3.000 paging limit and the
    // real 6.296 count. Scraping the first "N Treffer" yields the wrong number.
    const html = '<img alt="ans Ende springen" title="Das Bl&auml;ttern ans Ende der '
      + 'Trefferliste ist bei mehr als 3.000 Treffern nicht m&ouml;glich." />'
      + '<input type="hidden" name="numberofresults" value="6296" />';
    expect(parseFederalTotalHits(html)).toBe(6296);
  });

  it('falls back to the federal count carried in result links', () => {
    expect(parseFederalTotalHits('<a href="?doc.id=x&numberofresults=6296&z=1">1</a>')).toBe(6296);
  });

  it('returns undefined for federal markup that states no count', () => {
    expect(parseFederalTotalHits('<html><body>keine Treffer</body></html>')).toBeUndefined();
  });

  it('reads the NRW count out of its dedicated element, stripping the group separator', () => {
    const html = '<div id="anzahlGefunden">Es wurden <strong>20790</strong> Dokumente zu Ihrer Suche gefunden.</div>';
    expect(parseNrwTotalHits(html)).toBe(20790);
    expect(parseNrwTotalHits('<div id="anzahlGefunden">Es wurden <strong>1.234</strong> Dokumente gefunden.</div>')).toBe(1234);
    expect(parseNrwTotalHits('<div>no counter element</div>')).toBeUndefined();
  });

  it('reads the Niedersachsen count from the Rechtsprechung facet', () => {
    // NI publishes a count per facet; the search filters to Rechtsprechung, so
    // that facet is the matching total — not the larger Volltextdokument one.
    const html = '<button aria-label="Rechtsvorschriften Filter 87 Ergebnisse bei diesem Filter"></button>'
      + '<button aria-label="Rechtsprechung Filter 3487 Ergebnisse bei diesem Filter"></button>'
      + '<button aria-label="Volltextdokument Filter 3486 Ergebnisse bei diesem Filter"></button>';
    expect(parseNiedersachsenTotalHits(html)).toBe(3487);
    expect(parseNiedersachsenTotalHits('<div>no facets</div>')).toBeUndefined();
  });

  it('prefers Bayern\'s decision count over its match count', () => {
    // "2639 Treffer in 2608 Gerichtsentscheidungen": matches exceed documents
    // because one decision can match repeatedly.
    expect(parseBayernTotalHits('<p id="readable">2639 Treffer in 2608 Gerichtsentscheidungen</p>')).toBe(2608);
    // Without the document figure, the match count is the best available.
    expect(parseBayernTotalHits('<p>1.204 Treffer</p>')).toBe(1204);
    expect(parseBayernTotalHits('<p>nothing</p>')).toBeUndefined();
  });
});
