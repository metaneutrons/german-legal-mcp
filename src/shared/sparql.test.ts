import { describe, expect, it } from 'vitest';
import { isoDateLiteral, sparqlStringLiteral } from './sparql.js';

describe('SPARQL boundary encoding', () => {
  it('quotes backslashes, quotes and control characters as one literal', () => {
    expect(sparqlStringLiteral('x"\\\nSERVICE <https://evil.example>'))
      .toBe('"x\\"\\\\\\nSERVICE <https://evil.example>"');
  });

  it('accepts real calendar dates and rejects normalized or injected values', () => {
    expect(isoDateLiteral('2026-08-30')).toBe('2026-08-30');
    for (const value of [
      '2026-08-30T12:00:00Z',
      '2026-08-30trailing',
      '2026-02-31',
      '2026-13-01',
      '"^^xsd:string',
    ]) {
      expect(() => isoDateLiteral(value)).toThrow('Invalid ISO date');
    }
  });
});
