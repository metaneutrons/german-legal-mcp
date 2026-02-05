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
});
