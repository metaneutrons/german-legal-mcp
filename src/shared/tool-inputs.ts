import { z } from 'zod';
import { isoDateLiteral } from './sparql.js';

/** Shared transport-neutral limits for the public MCP argument surface. */
export const searchQuerySchema = z.string().trim().min(1).max(2_000);
export const resultLimitSchema = z.number().int().min(1).max(100);
export const pageNumberSchema = z.number().int().min(1).max(10_000);
export const sectionSelectorSchema = z.string().trim().min(1).max(500);
export const savePathSchema = z.string().min(1).max(4_096);
export const providerIdSchema = z.string().trim().min(1).max(2_048);
export const shortTextSchema = z.string().trim().min(1).max(500);
export const languageCodeSchema = z.string().regex(/^[A-Za-z]{2}$/, 'Language must be a two-letter code');
export const isoDateSchema = z.string().refine((value) => {
  try {
    isoDateLiteral(value);
    return true;
  } catch {
    return false;
  }
}, 'Date must be a real calendar date in YYYY-MM-DD form');
