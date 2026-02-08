import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BeckConverter } from '../src/providers/beck/converter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('BeckConverter Integration', () => {
  const converter = new BeckConverter();

  describe('with sample-document.html', () => {
    const html = readFileSync(join(fixturesDir, 'sample-document.html'), 'utf-8');

    it('extracts the correct title', () => {
      const result = converter.htmlToMarkdown(html);
      expect(result.title).toBe('§ 823 Schadensersatzpflicht');
    });

    it('converts paragraph numbers correctly', () => {
      const result = converter.htmlToMarkdown(html);
      expect(result.body).toContain('**(1)**');
      expect(result.body).toContain('**(2)**');
    });

    it('preserves legal content', () => {
      const result = converter.htmlToMarkdown(html);
      expect(result.body).toContain('vorsätzlich oder fahrlässig');
      expect(result.body).toContain('Schutz eines anderen bezweckendes Gesetz');
    });

    it('converts internal links to full URLs', () => {
      const result = converter.htmlToMarkdown(html);
      expect(result.body).toContain('[§ 249 BGB](https://beck-online.beck.de/Dokument?vpath=bibdata/ges/bgb/cont/bgb.p249.htm)');
    });

    it('removes footer content', () => {
      const result = converter.htmlToMarkdown(html);
      expect(result.body).not.toContain('Stand: 01.01.2024');
    });

    it('extracts navigation context', () => {
      const context = converter.extractContext(html);
      expect(context.siblings.previous).toContain('bgb.p822.htm');
      expect(context.siblings.next).toContain('bgb.p824.htm');
    });
  });

  describe('with access-denied.html', () => {
    const html = readFileSync(join(fixturesDir, 'access-denied.html'), 'utf-8');

    it('detects access denial', () => {
      expect(converter.isAccessDenied(html)).toBe(true);
    });
  });

  describe('with search-results.html', () => {
    const html = readFileSync(join(fixturesDir, 'search-results.html'), 'utf-8');

    it('does not detect as access denied', () => {
      expect(converter.isAccessDenied(html)).toBe(false);
    });
  });

  describe('with court-decision.html (real-world fixture)', () => {
    const html = readFileSync(join(fixturesDir, 'court-decision.html'), 'utf-8');

    it('extracts the correct title', () => {
      const result = converter.htmlToMarkdown(html);
      expect(result.title).toBe('BeckRS 2023, 52213');
    });

    it('converts Randnummern correctly', () => {
      const result = converter.htmlToMarkdown(html);
      expect(result.body).toContain('**[Rn. 1]**');
      expect(result.body).toContain('**[Rn. 2]**');
      expect(result.body).toContain('**[Rn. 10]**');
    });

    it('preserves court decision structure', () => {
      const result = converter.htmlToMarkdown(html);
      // Should contain Tenor section
      expect(result.body).toContain('Tenor');
      // Should contain Tatbestand
      expect(result.body).toContain('Tatbestand');
    });

    it('preserves legal citations', () => {
      const result = converter.htmlToMarkdown(html);
      expect(result.body).toContain('BGB');
      expect(result.body).toContain('UrhG');
    });

    it('extracts navigation context', () => {
      const context = converter.extractContext(html);
      expect(context.breadcrumbs).toContain('Rechtsprechung');
      expect(context.siblings.previous).toContain('beckrs.2023.52212');
      expect(context.siblings.next).toContain('beckrs.2023.52214');
    });

    it('does not detect as access denied', () => {
      expect(converter.isAccessDenied(html)).toBe(false);
    });
  });

  describe('with commentary.html (real-world fixture)', () => {
    const html = readFileSync(join(fixturesDir, 'commentary.html'), 'utf-8');

    it('extracts the correct title', () => {
      const result = converter.htmlToMarkdown(html);
      // Commentary title from BeckOK
      expect(result.title).toMatch(/UrhG|Urheberrecht/i);
    });

    it('converts Randnummern correctly', () => {
      const result = converter.htmlToMarkdown(html);
      expect(result.body).toContain('**[Rn. 21]**');
      expect(result.body).toContain('**[Rn. 21a]**');
      expect(result.body).toContain('**[Rn. 21b]**');
    });

    it('preserves commentary content', () => {
      const result = converter.htmlToMarkdown(html);
      // Should contain legal terminology
      expect(result.body).toContain('Vortrags');
      expect(result.body).toContain('Aufführungs');
    });

    it('extracts navigation context', () => {
      const context = converter.extractContext(html);
      expect(context.breadcrumbs).toContain('Kommentare');
      expect(context.siblings.previous).toBeDefined();
      expect(context.siblings.next).toBeDefined();
    });

    it('does not detect as access denied', () => {
      expect(converter.isAccessDenied(html)).toBe(false);
    });
  });

});
