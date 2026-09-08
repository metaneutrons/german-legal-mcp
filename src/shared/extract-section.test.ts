import { describe, it, expect } from 'vitest';
import { extractSection } from './extract-section.js';

const doc = [
  '# Kopf',
  'Intro line.',
  '# Spruch',
  'Die Revision wird zurückgewiesen.',
  '# Text',
  '[Rn. 1]{.rn} First paragraph.',
  '[Rn. 2]{.rn} Second paragraph.',
  '[Rn. 3]{.rn} Third paragraph.',
].join('\n');

describe('extractSection', () => {
  it('extracts a line range', () => {
    expect(extractSection(doc, 'lines:1-2')).toBe('# Kopf\nIntro line.');
  });

  it('extracts a single Randnummer', () => {
    expect(extractSection(doc, 'Rn 2')).toBe('[Rn. 2]{.rn} Second paragraph.');
  });

  it('extracts a Randnummer range', () => {
    expect(extractSection(doc, 'Rn 1-2')).toBe(
      '[Rn. 1]{.rn} First paragraph.\n[Rn. 2]{.rn} Second paragraph.',
    );
  });

  it('reports a missing Randnummer', () => {
    expect(extractSection(doc, 'Rn 9')).toContain('not found');
  });

  it('extracts a heading section up to the next same-level heading', () => {
    expect(extractSection(doc, 'Spruch')).toBe('# Spruch\nDie Revision wird zurückgewiesen.');
  });

  it('reports a missing heading/section', () => {
    expect(extractSection(doc, 'Nonexistent')).toContain('not found');
  });
});
