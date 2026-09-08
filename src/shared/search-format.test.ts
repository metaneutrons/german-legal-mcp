import { describe, expect, it } from 'vitest';
import {
  EMPTY_CELL,
  formatHitCount,
  renderSearchTable,
  type SearchColumn,
} from './search-format.js';

interface Hit {
  court?: string;
  date?: string;
  fileNumber?: string;
  id: string;
}

const columns: readonly SearchColumn<Hit>[] = [
  { header: 'court', value: (hit) => hit.court },
  { header: 'date', value: (hit) => hit.date },
  { header: 'az', value: (hit) => hit.fileNumber },
  { header: 'id', value: (hit) => hit.id },
];

const hits: Hit[] = [
  { court: 'BAG', date: '2026-07-22', fileNumber: '6 AZR 12/25', id: 'jb-KARE600072145' },
  { court: 'AG München', date: '2024-02-12', id: 'Y-300-Z-GRURRS-B-2024-N-25341' },
];

describe('renderSearchTable', () => {
  it('emits a tab-delimited table with a header row by default', () => {
    const lines = renderSearchTable({ columns, rows: hits }).split('\n');
    expect(lines[0]).toBe('court\tdate\taz\tid');
    expect(lines[1]).toBe('BAG\t2026-07-22\t6 AZR 12/25\tjb-KARE600072145');
  });

  it('substitutes a placeholder so a missing field cannot shift later columns', () => {
    const row = renderSearchTable({ columns, rows: [hits[1]!] }).split('\n')[1]!;
    expect(row.split('\t')).toEqual([
      'AG München', '2024-02-12', EMPTY_CELL, 'Y-300-Z-GRURRS-B-2024-N-25341',
    ]);
  });

  it('strips tabs and newlines out of values, which would otherwise corrupt a row', () => {
    const row = renderSearchTable({
      columns,
      rows: [{ court: 'LAG\tKöln', date: 'Urteil\nvom 2026', id: 'x' }],
    }).split('\n')[1]!;
    expect(row.split('\t')).toEqual(['LAG Köln', 'Urteil vom 2026', EMPTY_CELL, 'x']);
  });

  it('truncates an over-wide cell on a word boundary and marks the cut', () => {
    const keywordDump = 'Abgasskandal; Abschalteinrichtung; Dieselskandal; Beweislast; '
      + 'Darlegungslast; immaterieller Schaden; Wertminderung; Unionsrecht';
    const row = renderSearchTable({
      columns: [{ header: 'title', value: () => keywordDump, maxWidth: 40 }],
      rows: [hits[0]!],
    }).split('\n')[1]!;

    expect(row.length).toBeLessThanOrEqual(41);
    expect(row.endsWith('…')).toBe(true);
    expect(row).not.toContain('Unionsrecht');
    // Cut between words, not mid-token.
    expect(row.slice(0, -1).trimEnd()).toBe(row.slice(0, -1));
  });

  it('leaves a cell inside its limit untouched', () => {
    const row = renderSearchTable({
      columns: [{ header: 'title', value: () => 'BGH VI ZR 97/22', maxWidth: 120 }],
      rows: [hits[0]!],
    }).split('\n')[1]!;
    expect(row).toBe('BGH VI ZR 97/22');
  });

  it('places the prose summary above the table, separated by a blank line', () => {
    const lines = renderSearchTable({
      columns,
      rows: hits,
      summary: ['6.296 results', 'BUND 6.296 · BY 2.639'],
    }).split('\n');
    expect(lines.slice(0, 4)).toEqual([
      '6.296 results', 'BUND 6.296 · BY 2.639', '', 'court\tdate\taz\tid',
    ]);
  });

  it('advertises the cursor only when more results exist', () => {
    expect(renderSearchTable({ columns, rows: hits })).not.toContain('cursor');
    expect(renderSearchTable({ columns, rows: hits, cursor: 'eyJwIjoyfQ' }))
      .toContain('pass cursor: eyJwIjoyfQ');
  });

  it('carries identical data in compact-json, keyed once via a columnar shape', () => {
    const parsed = JSON.parse(renderSearchTable({
      columns, rows: hits, summary: ['2 results'], cursor: 'c1', format: 'compact-json',
    })) as { summary: string[]; fields: string[]; rows: string[][]; cursor: string };

    expect(parsed.fields).toEqual(['court', 'date', 'az', 'id']);
    expect(parsed.rows[0]).toEqual(['BAG', '2026-07-22', '6 AZR 12/25', 'jb-KARE600072145']);
    expect(parsed.rows[1]?.[2]).toBe(EMPTY_CELL);
    expect(parsed.summary).toEqual(['2 results']);
    expect(parsed.cursor).toBe('c1');
  });

  it('stays cheaper than an array of per-row objects, which is the whole point', () => {
    const rows = Array.from({ length: 30 }, () => hits[0]!);
    const compact = renderSearchTable({ columns, rows });
    const columnar = renderSearchTable({ columns, rows, format: 'compact-json' });
    const perRowObjects = JSON.stringify(
      rows.map((hit) => ({ court: hit.court, date: hit.date, az: hit.fileNumber, id: hit.id })),
      null,
      2,
    );

    expect(compact.length).toBeLessThan(columnar.length);
    expect(columnar.length).toBeLessThan(perRowObjects.length);
  });
});

describe('formatHitCount', () => {
  it('reports the total only when it exceeds what is shown', () => {
    expect(formatHitCount(10, 6296)).toBe('10 of 6.296 results');
    expect(formatHitCount(12, 12)).toBe('12 results');
    expect(formatHitCount(5)).toBe('5 results');
  });
});
