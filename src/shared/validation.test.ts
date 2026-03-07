import { describe, it, expect } from 'vitest';
import { validateSearchQuery, validateSection } from './validation.js';
import { ValidationError } from './errors.js';

describe('Validation', () => {
  describe('validateSearchQuery', () => {
    it('accepts valid query', () => {
      expect(validateSearchQuery('test query')).toBe('test query');
    });

    it('rejects empty query', () => {
      expect(() => validateSearchQuery('')).toThrow(ValidationError);
    });
  });

  describe('validateSection', () => {
    it('accepts Rn format', () => {
      expect(validateSection('Rn 5')).toBe('Rn 5');
      expect(validateSection('Rn 5-12')).toBe('Rn 5-12');
    });

    it('accepts lines format', () => {
      expect(validateSection('lines:100-200')).toBe('lines:100-200');
    });

    it('accepts heading text', () => {
      expect(validateSection('I. Allgemeines')).toBe('I. Allgemeines');
    });

    it('rejects empty section', () => {
      expect(() => validateSection('')).toThrow(ValidationError);
    });
  });
});
