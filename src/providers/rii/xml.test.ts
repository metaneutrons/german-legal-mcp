import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readFirstZipEntry } from '../../shared/zip.js';
import { parseRiiDocument } from './xml.js';

function realDecision() {
  const buffer = readFileSync(new URL('./adapters/fixtures/decision.zip', import.meta.url));
  return parseRiiDocument(readFirstZipEntry(buffer).data.toString('utf8'));
}

describe('parseRiiDocument', () => {
  it('extracts the tagged metadata the rendered page does not carry', () => {
    expect(realDecision()).toMatchObject({
      docNumber: 'KORE300012024',
      ecli: 'ECLI:DE:BGH:2023:121023BIZB28.23.0',
      court: 'BGH',
      chamber: '1. Zivilsenat',
      decisionDate: '2023-10-12',
      fileNumber: 'I ZB 28/23',
      documentType: 'Beschluss',
    });
  });

  it('splits cited norms without shattering them at internal commas', () => {
    // Published as one string: "§ 8 Abs 2 Nr 1 MarkenG, § 8 Abs 2 Nr 2 MarkenG".
    // Splitting on every comma would produce "§ 8 Abs 2 Nr 1 MarkenG" plus
    // fragments, so the split only fires before a new § or Art. marker.
    expect(realDecision().citedNorms).toEqual([
      '§ 8 Abs 2 Nr 1 MarkenG',
      '§ 8 Abs 2 Nr 2 MarkenG',
    ]);
  });

  it('carries prior instances, which are decision-to-decision citation edges', () => {
    expect(realDecision().priorInstances).toEqual([
      'vorgehend BPatG München, 19. Januar 2023, Az: 25 W (pat) 526/21, Beschluss',
    ]);
  });

  it('renders Randnummern with the same marker the HTML converter emits', () => {
    const { markdown } = realDecision();
    // Consumers must not be able to tell which route produced a document.
    expect(markdown).toMatch(/\[Rn\. 1\]\{\.rn\}/);
    expect((markdown.match(/\[Rn\. \d+\]\{\.rn\}/g) ?? []).length).toBe(44);
  });

  it('keeps section boundaries, which 512-token windows would otherwise sever', () => {
    const { markdown, headnotes } = realDecision();
    expect(markdown).toContain('## Leitsatz');
    expect(markdown).toContain('## Gründe');
    expect(headnotes.length).toBeGreaterThan(0);
  });

  it('falls back to a citation-shaped title when the source states none', () => {
    const minimal = '<dokument><doknr>X1</doknr><gertyp>BGH</gertyp>'
      + '<spruchkoerper>2. Strafsenat</spruchkoerper><aktenzeichen>2 StR 1/26</aktenzeichen>'
      + '<entsch-datum>20260101</entsch-datum><gruende><dl><dt>1</dt><dd>Text.</dd></dl></gruende>'
      + '</dokument>';
    const parsed = parseRiiDocument(minimal);

    expect(parsed.title).toBe('BGH 2. Strafsenat | 2 StR 1/26');
    expect(parsed.decisionDate).toBe('2026-01-01');
    expect(parsed.citedNorms).toEqual([]);
  });
});
