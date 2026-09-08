import { describe, expect, it } from 'vitest';
import { BremenDecisionAdapter, parseBremenLinkTitle } from './bremen.js';

const html = `<table><tr class="search-result"><td><em>03.07.2026</em></td><td><a href="detail.php?gsid=bremen73.c.26955.de" title="Tierschutz, 5 V 709/26, Beschluss vom 03.07.2026">Tierschutz, 5 V 709/26, Beschluss vom 03.07.2026</a><br>Zur Rechtmäßigkeit der Fortnahme und Veräußerung von Hunden</td></tr></table>`;

describe('BremenDecisionAdapter', () => {
  it('filters official VG overview results and preserves detail URL', async () => {
    const adapter = new BremenDecisionAdapter({ get: async () => ({ data: html }) });
    const results = await adapter.search('HB', 'Hunde', 10);
    // The file number used to stay glued to the title while the `az` column sat
    // empty; it now has its own field and the title keeps only the subject.
    expect(results[0]).toMatchObject({
      title: 'Tierschutz',
      fileNumber: '5 V 709/26',
      date: '03.07.2026',
      court: 'Verwaltungsgericht Bremen',
    });
    expect(results[0].id).toContain('detail.php');
  });

  it('handles archive rows without a detail link and converts detail HTML', async () => {
    const adapter = new BremenDecisionAdapter({ get: async (url) => ({ data: url.includes('detail') ? '<main><h1>Testentscheidung</h1><p>Beschluss vom 01.01.2026, 1 V 2/26</p></main>' : '<table><tr class="search-result"><td><em>01.01.2026</em></td><td>Archivhinweis</td></tr></table>' }) });
    expect(await adapter.search('HB', '', 10)).toHaveLength(1);
    const entry = await adapter.get(
      'HB',
      'https://www.verwaltungsgericht.bremen.de/entscheidungen/detail-12345',
    );
    expect(entry.content).toContain('Beschluss');
    expect(entry.date).toBe('01.01.2026');
  });
});

describe('parseBremenLinkTitle', () => {
  it('separates subject and file number', () => {
    expect(parseBremenLinkTitle('Schulzuweisung Sek I, 1 V 2155/26, Beschluss vom 29.07.2026'))
      .toEqual({ title: 'Schulzuweisung Sek I', fileNumber: '1 V 2155/26' });
  });

  it('keeps commas that belong to the subject', () => {
    // Anchoring the file number from the end is what makes this work; matching
    // the subject lazily would report "Aussetzung vorläufige Dienstenthebung"
    // as the file number.
    expect(parseBremenLinkTitle(
      'Disziplinarrecht Bundesbeamte, Aussetzung vorläufige Dienstenthebung, 8 V 1410/26, Beschluss vom 23.07.2026',
    )).toEqual({
      title: 'Disziplinarrecht Bundesbeamte, Aussetzung vorläufige Dienstenthebung',
      fileNumber: '8 V 1410/26',
    });
  });

  it('requires a digit in the file-number position', () => {
    // Without that requirement the last clause of a subject would be taken as a
    // file number for any three-comma title.
    expect(parseBremenLinkTitle('Ein Thema, noch ein Teil, Beschluss vom 01.01.2026'))
      .toEqual({ title: 'Ein Thema, noch ein Teil' });
  });

  it('falls back to dropping only the trailing clause when unrecognized', () => {
    expect(parseBremenLinkTitle('Nur ein Titel ohne Struktur'))
      .toEqual({ title: 'Nur ein Titel ohne Struktur' });
  });
});
