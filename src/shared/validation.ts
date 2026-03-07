import { z } from 'zod';
import { ValidationError } from './errors.js';

/**
 * Zod schema for search query validation.
 * Max length: 500 characters.
 */
export const SearchQuerySchema = z.string()
  .min(1, 'Search query cannot be empty')
  .max(500, 'Search query too long (max 500 characters)');

/**
 * Zod schema for section identifier validation.
 * Accepts: "Rn X", "Rn X-Y", "lines:X-Y", or heading text.
 */
export const SectionSchema = z.string()
  .min(1, 'Section cannot be empty')
  .refine(
    (val) => /^(Rn\s+\d+(-\d+)?|lines:\d+-\d+|.+)$/.test(val),
    'Section must be "Rn X", "Rn X-Y", "lines:X-Y", or heading text'
  );

/**
 * Validate a search query string.
 * @throws {ValidationError} If validation fails
 */
export function validateSearchQuery(query: unknown): string {
  try {
    return SearchQuerySchema.parse(query);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError(error.issues[0].message, 'query');
    }
    throw error;
  }
}

/**
 * Validate a section identifier.
 * @throws {ValidationError} If validation fails
 */
export function validateSection(section: unknown): string {
  try {
    return SectionSchema.parse(section);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError(error.issues[0].message, 'section');
    }
    throw error;
  }
}
