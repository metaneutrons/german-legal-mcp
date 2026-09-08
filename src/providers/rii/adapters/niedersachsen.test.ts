import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  NiedersachsenDecisionAdapter,
  isEmptyResultResponse,
  parseNiedersachsenHeading,
} from './niedersachsen.js';

/** Shaped like the axios error the portal actually produces. */
const httpError = (status: number, body: string) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, data: body },
});

const EMPTY_STATE = '<div class="view-empty">Es wurden keine passenden Dokumente gefunden.</div>';

describe('NiedersachsenDecisionAdapter', () => {
  it('regresses NI-VORIS search and full-text conversion against HTML samples', async () => {
    const html = await readFile(new URL('./fixtures/ni-decision.html', import.meta.url), 'utf8');
    const adapter = new NiedersachsenDecisionAdapter({ get: async (_url, options) => ({ data: options?.params?.query ? '<div class="egal-search-result-item"><div class="egal-search-result-item-title"><h3><a href="/browse/document/ni-1">OVG Niedersachsen, 22.07.2008 - 5 LA 426/07</a></h3></div><p class="egal-search-result-item-snippet">VwVfG Niedersachsen</p><p class="egal-search-result-item-extra">Entscheidungsdatum: 22.07.2008</p></div>' : html }) });
    await expect(adapter.search('NI', 'VwVfG', 1)).resolves.toMatchObject([{ id: 'ni-1', date: '22.07.2008', court: 'OVG Niedersachsen' }]);
    await expect(adapter.get('NI', 'ni-1')).resolves.toMatchObject({ fileNumber: '5 LA 426/07', content: expect.stringContaining('Die Beschwerde wird zurückgewiesen.') });
  });

  it('recovers the file number a search heading carries', async () => {
    const heading = 'LAG Niedersachsen, 29.05.2026 - 17 SLa 619/25 - Ansprüche auf Schadensersatz';
    const adapter = new NiedersachsenDecisionAdapter({
      get: async () => ({
        data: '<div class="egal-search-result-item"><div class="egal-search-result-item-title"><h3>'
          + `<a href="/browse/document/ni-2">${heading}</a></h3></div>`
          + '<p class="egal-search-result-item-extra">Entscheidungsdatum: 29.05.2026</p></div>',
      }),
    });
    // rii_search renders an `az` column; NI left it empty while the number sat
    // in the heading. The court, date and number also come back out of the
    // title, which has its own width budget to spend on the subject.
    await expect(adapter.search('NI', 'Schadensersatz', 1)).resolves.toMatchObject([{
      court: 'LAG Niedersachsen',
      fileNumber: '17 SLa 619/25',
      date: '29.05.2026',
      title: 'Ansprüche auf Schadensersatz',
    }]);
  });

  it('parses the current wkde bibliography definition list', async () => {
    const html = '<html><head><title>Fallback | NI-VORIS</title></head><body>'
      + '<h1 class="wkde-doctitle">Datenschutzrechtliche Entscheidung</h1>'
      + '<div class="wkde-bibliography"><dl>'
      + '<dt>Gericht</dt><dd>OVG Niedersachsen</dd>'
      + '<dt>Datum</dt><dd>03.08.2026</dd>'
      + '<dt>Aktenzeichen</dt><dd>11 LA 42/26</dd>'
      + '<dt>ECLI</dt><dd>ECLI:DE:OVGNI:2026:0803.11LA42.26.00</dd>'
      + '</dl></div>'
      + '<div class="wkde-document-body"><p>Die Entscheidung enthält einen vollständigen Text.</p></div>'
      + '</body></html>';
    const adapter = new NiedersachsenDecisionAdapter({ get: async () => ({ data: html }) });

    await expect(adapter.get('NI', 'ni-current')).resolves.toMatchObject({
      title: 'Datenschutzrechtliche Entscheidung',
      court: 'OVG Niedersachsen',
      date: '03.08.2026',
      fileNumber: '11 LA 42/26',
      ecli: 'ECLI:DE:OVGNI:2026:0803.11LA42.26.00',
    });
  });

  it('parses legacy field labels case-insensitively with optional colons', async () => {
    const html = '<html><body><h1>Legacy-Entscheidung</h1>'
      + '<div class="field">gericht OVG Niedersachsen</div>'
      + '<div class="views-field">Entscheidungsdatum: 03.08.2026</div>'
      + '<div class="field">AKTENZEICHEN : 11 LA 42/26</div>'
      + '<div class="views-field">ecli ECLI:DE:OVGNI:2026:0803.11LA42.26.00</div>'
      + '<div class="wkde-document-body"><p>Volltext</p></div></body></html>';
    const adapter = new NiedersachsenDecisionAdapter({ get: async () => ({ data: html }) });

    await expect(adapter.get('NI', 'ni-legacy')).resolves.toMatchObject({
      court: 'OVG Niedersachsen',
      date: '03.08.2026',
      fileNumber: '11 LA 42/26',
      ecli: 'ECLI:DE:OVGNI:2026:0803.11LA42.26.00',
    });
  });
});

describe('NI zero-result 404s', () => {
  it('reads a no-hits search as an empty page, not a source failure', async () => {
    // Measured against the live portal: "DMA Bußgeld" and a nonsense term both
    // 404 while DSGVO returns 200. Treating that as a failure is why NI was
    // reported unavailable for most queries and contributed nothing.
    const adapter = new NiedersachsenDecisionAdapter({
      get: async () => {
        throw httpError(404, `<html><body>${EMPTY_STATE}</body></html>`);
      },
    });
    await expect(adapter.searchPage('NI', 'DMA Bußgeld', 10)).resolves.toEqual({
      results: [],
    });
  });

  it('still fails when a 404 does not carry the portal empty state', async () => {
    // A moved or renamed endpoint must stay loud; both 404s carry the site
    // chrome, so only the empty state tells them apart.
    const adapter = new NiedersachsenDecisionAdapter({
      get: async () => {
        throw httpError(404, '<html><body><main>Seite nicht gefunden</main></body></html>');
      },
    });
    await expect(adapter.searchPage('NI', 'DSGVO', 10)).rejects.toThrow(/404/);
  });

  it('does not swallow other transport errors', async () => {
    const adapter = new NiedersachsenDecisionAdapter({
      get: async () => {
        throw httpError(500, EMPTY_STATE);
      },
    });
    await expect(adapter.searchPage('NI', 'DSGVO', 10)).rejects.toThrow(/500/);
  });
});

describe('isEmptyResultResponse', () => {
  it('accepts only a 404 carrying the empty state', () => {
    expect(isEmptyResultResponse(httpError(404, EMPTY_STATE))).toBe(true);
    expect(isEmptyResultResponse(httpError(404, 'Seite nicht gefunden'))).toBe(false);
    expect(isEmptyResultResponse(httpError(500, EMPTY_STATE))).toBe(false);
    expect(isEmptyResultResponse(new Error('socket hang up'))).toBe(false);
    expect(isEmptyResultResponse(undefined)).toBe(false);
  });
});

describe('parseNiedersachsenHeading', () => {
  it('splits the four-part heading', () => {
    expect(parseNiedersachsenHeading('OLG Celle, 12.05.2026 - 13 U 88/25 - Anspruch auf Schadensersatz'))
      .toEqual({
        court: 'OLG Celle',
        date: '12.05.2026',
        fileNumber: '13 U 88/25',
        title: 'Anspruch auf Schadensersatz',
      });
  });

  it('handles a heading with no subject, as the stored fixture has', () => {
    const parsed = parseNiedersachsenHeading('OVG Niedersachsen, 22.07.2008 - 5 LA 426/07');
    expect(parsed).toMatchObject({
      court: 'OVG Niedersachsen',
      date: '22.07.2008',
      fileNumber: '5 LA 426/07',
    });
    // Nothing left to title it with, so the heading stands in rather than
    // leaving the cell empty.
    expect(parsed.title).toBe('OVG Niedersachsen, 22.07.2008 - 5 LA 426/07');
  });

  it('keeps a hyphenated file number intact', () => {
    // The reason the separator requires surrounding whitespace: `\s*-\s*` also
    // matches the bare hyphen inside `1-2/20` and would cut the number in half.
    expect(parseNiedersachsenHeading('BVerfG, 01.02.2020 - 2 BvR 1-2/20 - Verfassungsbeschwerde'))
      .toMatchObject({ fileNumber: '2 BvR 1-2/20', title: 'Verfassungsbeschwerde' });
  });

  it('keeps a subject that itself contains a separator', () => {
    expect(parseNiedersachsenHeading('OLG Celle, 01.06.2026 - 24 U 92/25 - Kündigung - fristlos'))
      .toMatchObject({ fileNumber: '24 U 92/25', title: 'Kündigung - fristlos' });
  });

  it('falls back to the whole heading when the shape is unrecognized', () => {
    expect(parseNiedersachsenHeading('Irgendwas ohne Struktur'))
      .toEqual({ title: 'Irgendwas ohne Struktur' });
  });

  it('still recovers the court when only the leading comma is present', () => {
    expect(parseNiedersachsenHeading('OVG Niedersachsen, ohne Datum und Aktenzeichen'))
      .toEqual({ court: 'OVG Niedersachsen', title: 'OVG Niedersachsen, ohne Datum und Aktenzeichen' });
  });
});
