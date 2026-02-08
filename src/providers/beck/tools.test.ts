import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'fs';
import { join } from 'path';
import { beckToolDefinitions, parseRelatedContent } from './tools.js';

describe('Beck Tools', () => {
  describe('Property 7: Beck Tool Naming Convention', () => {
    /**
     * Property 7: Beck Tool Naming Convention
     * For any tool definition returned by the Beck provider's getTools(),
     * the tool name SHALL start with the prefix 'beck:'.
     *
     * **Validates: Requirements 5.1**
     */
    it('all Beck tools start with "beck:" prefix', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...beckToolDefinitions),
          (tool) => {
            return tool.name.startsWith('beck:');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all Beck tools have non-empty names after prefix', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...beckToolDefinitions),
          (tool) => {
            const nameAfterPrefix = tool.name.slice('beck:'.length);
            return nameAfterPrefix.length > 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all Beck tools have descriptions', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...beckToolDefinitions),
          (tool) => {
            return typeof tool.description === 'string' && tool.description.length > 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all Beck tools have input schemas', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...beckToolDefinitions),
          (tool) => {
            return tool.inputSchema !== undefined && tool.inputSchema !== null;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


describe('parseRelatedContent', () => {
  const fixtureHtml = readFileSync(join(process.cwd(), 'tests/fixtures/verweiszettel.html'), 'utf-8');

  it('extracts document title from page', () => {
    const result = parseRelatedContent(fixtureHtml);
    expect(result.documentTitle).toBe('[UrhG] § 15');
  });

  it('extracts commentaries from Verweiszettel', () => {
    const result = parseRelatedContent(fixtureHtml);
    expect(result.commentaries.length).toBeGreaterThan(0);
    expect(result.commentaries.some(c => c.title.includes('BeckOK Urheberrecht'))).toBe(true);
    expect(result.commentaries.some(c => c.title.includes('Dreier/Schulze'))).toBe(true);
  });

  it('extracts handbooks from Verweiszettel', () => {
    const result = parseRelatedContent(fixtureHtml);
    expect(result.handbooks.length).toBeGreaterThan(0);
    expect(result.handbooks.some(h => h.title.includes('Rechtsanwaltshandbuch'))).toBe(true);
  });

  it('extracts case law from Verweiszettel', () => {
    const result = parseRelatedContent(fixtureHtml);
    expect(result.caseLaw.length).toBeGreaterThan(0);
    expect(result.caseLaw.some(c => c.title.includes('BGH'))).toBe(true);
  });

  it('extracts articles from Verweiszettel', () => {
    const result = parseRelatedContent(fixtureHtml);
    expect(result.articles.length).toBeGreaterThan(0);
    expect(result.articles.some(a => a.title.includes('NJW 2024'))).toBe(true);
  });

  it('extracts vpath from document links', () => {
    const result = parseRelatedContent(fixtureHtml);
    const beckOkCommentary = result.commentaries.find(c => c.title.includes('BeckOK Urheberrecht'));
    expect(beckOkCommentary?.vpath).toContain('beckokurhr');
  });

  it('returns empty arrays for missing sections', () => {
    const emptyHtml = '<html><head><title>Test</title></head><body></body></html>';
    const result = parseRelatedContent(emptyHtml);
    expect(result.commentaries).toEqual([]);
    expect(result.handbooks).toEqual([]);
    expect(result.caseLaw).toEqual([]);
    expect(result.articles).toEqual([]);
    expect(result.citedInNorms).toEqual([]);
    expect(result.administrativeRegulations).toEqual([]);
    expect(result.other).toEqual([]);
  });
});
