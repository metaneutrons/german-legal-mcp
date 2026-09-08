import { describe, expect, it } from 'vitest';
import { clusterDecisions, describeClusters } from './cluster.js';
import type { SourcedDecisionSearchResult } from './types.js';

/** The real BGH Diesel opening clause, which differs only in the vehicle. */
const DIESEL = 'Der Kläger nimmt die Beklagte wegen der Verwendung unzulässiger '
  + 'Abschalteinrichtungen in einem Kraftfahrzeug auf Schadensersatz in Anspruch.';

function hit(
  fileNumber: string,
  date: string,
  overrides: Partial<SourcedDecisionSearchResult> = {},
): SourcedDecisionSearchResult {
  return {
    source: 'BUND',
    id: `id-${fileNumber}`,
    title: DIESEL,
    subtitle: '',
    date,
    court: 'BGH 6a. Zivilsenat',
    fileNumber,
    ...overrides,
  };
}

describe('clusterDecisions', () => {
  it('collapses a mass-litigation series into its newest member', () => {
    const clusters = clusterDecisions([
      hit('VIa ZR 782/23', '28.07.2026'),
      hit('VIa ZR 24/23', '22.07.2026'),
      hit('VIa ZR 208/23', '16.07.2026'),
      hit('VIa ZR 970/23', '14.07.2026'),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.representative.fileNumber).toBe('VIa ZR 782/23');
    expect(clusters[0]?.collapsed).toHaveLength(3);
  });

  it('leaves genuinely different decisions from the same court alone', () => {
    const clusters = clusterDecisions([
      hit('VIa ZR 782/23', '28.07.2026'),
      hit('VII ZR 128/25', '22.07.2026', {
        title: 'Mit der Klage hat sie im Wege des Regresses Schadensersatz verlangt.',
        court: 'BGH 7. Zivilsenat',
      }),
      hit('VI ZR 33/26', '21.07.2026', {
        title: 'Der Kläger nimmt die Beklagten nach einem Verkehrsunfall in Anspruch.',
        court: 'BGH 6. Zivilsenat',
      }),
    ]);
    expect(clusters).toHaveLength(3);
    expect(clusters.every((cluster) => cluster.collapsed.length === 0)).toBe(true);
  });

  it('does not collapse a pair — hiding one decision saves nothing', () => {
    const clusters = clusterDecisions([
      hit('VIa ZR 1/23', '28.07.2026'),
      hit('VIa ZR 2/23', '22.07.2026'),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('separates identical wording from different courts', () => {
    const clusters = clusterDecisions([
      hit('VIa ZR 1/23', '28.07.2026'),
      hit('VIa ZR 2/23', '27.07.2026'),
      hit('VIa ZR 3/23', '26.07.2026'),
      hit('5 U 1/23', '25.07.2026', { court: 'OLG Braunschweig' }),
      hit('5 U 2/23', '24.07.2026', { court: 'OLG Braunschweig' }),
      hit('5 U 3/23', '23.07.2026', { court: 'OLG Braunschweig' }),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.representative.court))
      .toEqual(['BGH 6a. Zivilsenat', 'OLG Braunschweig']);
  });

  it('keeps ranking order for the representatives', () => {
    const clusters = clusterDecisions([
      hit('X 1/23', '01.01.2020', { court: 'LAG Köln', title: 'Kündigung wegen Krankheit' }),
      hit('VIa ZR 1/23', '28.07.2026'),
      hit('VIa ZR 2/23', '27.07.2026'),
      hit('VIa ZR 3/23', '26.07.2026'),
    ]);
    // LAG appeared first in the ranked input and stays first.
    expect(clusters[0]?.representative.court).toBe('LAG Köln');
  });
});

describe('describeClusters', () => {
  it('names what was collapsed so nothing is hidden silently', () => {
    const clusters = clusterDecisions([
      hit('VIa ZR 782/23', '28.07.2026'),
      hit('VIa ZR 24/23', '22.07.2026'),
      hit('VIa ZR 208/23', '16.07.2026'),
    ]);
    const [note] = describeClusters(clusters);
    expect(note).toContain('2 further near-identical');
    expect(note).toContain('BGH 6a. Zivilsenat');
    expect(note).toContain('VIa ZR 24/23');
  });

  it('caps the listed file numbers and counts the remainder', () => {
    const clusters = clusterDecisions(
      Array.from({ length: 9 }, (_, index) => hit(`VIa ZR ${index}/23`, `0${index + 1}.01.2026`)),
    );
    const [note] = describeClusters(clusters);
    expect(note).toContain('8 further near-identical');
    expect(note).toContain('+4 more');
  });

  it('says nothing when nothing was collapsed', () => {
    expect(describeClusters(clusterDecisions([hit('X 1/23', '01.01.2026')]))).toEqual([]);
  });
});
