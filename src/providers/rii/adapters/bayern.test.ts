import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { BayernDecisionAdapter, parseBayernResult } from './bayern.js';

describe('BayernDecisionAdapter', () => {
  it('regresses search and conversion against a real gesetze-bayern-shaped HTML sample', async () => {
    const html = await readFile(new URL('./fixtures/bayern-decision.html', import.meta.url), 'utf8');
    const adapter = new BayernDecisionAdapter({
      search: async () => ({ results: [{ title: 'Mietminderung bei Schimmel', docId: 'Y-300-Z-BECKRS-2021-12345', subtitle: 'Der Mieter darf die Miete mindern.' }], totalHits: 2608 }),
      get: async () => html,
    });
    await expect(adapter.search('BY', 'Mietminderung', 1)).resolves.toMatchObject([{ id: 'Y-300-Z-BECKRS-2021-12345' }]);
    await expect(adapter.searchPage('BY', 'Mietminderung', 1)).resolves.toMatchObject({ totalHits: 2608 });
    await expect(adapter.get('BY', 'Y-300-Z-BECKRS-2021-12345')).resolves.toMatchObject({ court: 'AG München', fileNumber: '142 C 14251/20', content: expect.stringContaining('[Rn. 1]{.rn}') });
  });

  it('lifts court, date and file number out of the two result lines', async () => {
    const adapter = new BayernDecisionAdapter({
      search: async () => ({
        results: [{
          title: 'OLG Bamberg: Schadensersatz',
          docId: 'Y-300-Z-2023-N-57878',
          subtitle: 'Urteil vom 01.08.2023 – 5 U 351/21',
        }],
      }),
      get: async () => '',
    });
    // All three were absent before: no court, no az, and a hardcoded empty date
    // that also excluded BY from the date tie-break between equal scores.
    await expect(adapter.search('BY', 'Schadensersatz', 1)).resolves.toMatchObject([{
      court: 'OLG Bamberg',
      fileNumber: '5 U 351/21',
      date: '01.08.2023',
      title: 'Schadensersatz',
    }]);
  });
});

describe('parseBayernResult', () => {
  it('reads the en-dash metadata line', () => {
    expect(parseBayernResult('LG Augsburg: Beweislastverteilung', 'Endurteil vom 04.02.2025 – 125 O 1155/24'))
      .toEqual({
        court: 'LG Augsburg',
        date: '04.02.2025',
        fileNumber: '125 O 1155/24',
        title: 'Beweislastverteilung',
      });
  });

  it('accepts file-number forms that are not slash-separated', () => {
    // Live examples that a stricter pattern would drop.
    expect(parseBayernResult('BayObLG: Kündigung', 'Beschluss vom 21.02.2024 – Verg 5/23 e').fileNumber)
      .toBe('Verg 5/23 e');
    expect(parseBayernResult('VG München: Heizkosten', 'Urteil vom 02.03.2022 – M 5 K 21.5645').fileNumber)
      .toBe('M 5 K 21.5645');
  });

  it('leaves the heading alone when the subtitle is not a decision line', () => {
    // Legislation shares the result page and carries `Rechtsstand: <date>`.
    // Carving its heading at the colon would invent a court.
    expect(parseBayernResult('Leihverkehrsordnung – 18. Rücksendung, Schadensersatz (LVO)', 'Rechtsstand: 01.01.2004'))
      .toEqual({ title: 'Leihverkehrsordnung – 18. Rücksendung, Schadensersatz (LVO)' });
  });

  it('keeps the whole heading when it carries no court prefix', () => {
    expect(parseBayernResult('Schadensersatz ohne Gerichtsangabe', 'Urteil vom 01.08.2023 – 5 U 351/21'))
      .toEqual({ date: '01.08.2023', fileNumber: '5 U 351/21', title: 'Schadensersatz ohne Gerichtsangabe' });
  });

  it('ignores a colon too far into a long heading to be a court', () => {
    const heading = `${'Sehr langer Betreff ohne Gericht'.repeat(3)}: Nachsatz`;
    expect(parseBayernResult(heading, 'Urteil vom 01.08.2023 – 5 U 351/21').court).toBeUndefined();
  });
});
