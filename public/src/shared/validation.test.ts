import { describe, it, expect } from 'vitest';
import { validateVpath, validateSearchQuery, validateSection } from './validation.js';
import { ValidationError } from './errors.js';

describe('validation', () => {
  describe('validateVpath', () => {
    it('should accept bibdata path', () => {
      expect(validateVpath('bibdata/komm/123')).toBe('bibdata/komm/123');
    });

    it('should accept full URL', () => {
      expect(validateVpath('https://beck-online.beck.de/test')).toBe('https://beck-online.beck.de/test');
    });

    it('should reject empty string', () => {
      expect(() => validateVpath('')).toThrow(ValidationError);
    });

    it('should reject invalid format', () => {
      expect(() => validateVpath('invalid/path')).toThrow(ValidationError);
    });
  });

  describe('validateSearchQuery', () => {
    it('should accept valid query', () => {
      expect(validateSearchQuery('test query')).toBe('test query');
    });

    it('should reject empty string', () => {
      expect(() => validateSearchQuery('')).toThrow(ValidationError);
    });

    it('should reject too long query', () => {
      const longQuery = 'a'.repeat(501);
      expect(() => validateSearchQuery(longQuery)).toThrow(ValidationError);
    });
  });

  describe('validateSection', () => {
    it('should accept Rn format', () => {
      expect(validateSection('Rn 5')).toBe('Rn 5');
      expect(validateSection('Rn 5-10')).toBe('Rn 5-10');
    });

    it('should accept lines format', () => {
      expect(validateSection('lines:10-20')).toBe('lines:10-20');
    });

    it('should accept heading text', () => {
      expect(validateSection('Introduction')).toBe('Introduction');
    });

    it('should reject empty string', () => {
      expect(() => validateSection('')).toThrow(ValidationError);
    });
  });
});
