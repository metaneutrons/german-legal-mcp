import { describe, it, expect } from 'vitest';
import { RisConverter } from './converter.js';

describe('RisConverter', () => {
  const converter = new RisConverter();

  describe('convertToMarkdown', () => {
    it('converts basic HTML to markdown', () => {
      const html = '<h1>Title</h1><p>Paragraph text.</p>';
      const result = converter.convertToMarkdown(html);
      expect(result).toContain('# Title');
      expect(result).toContain('Paragraph text.');
    });

    it('preserves links', () => {
      const html = '<a href="/path/to/doc">Link text</a>';
      const result = converter.convertToMarkdown(html);
      expect(result).toContain('[Link text](https://testphase.rechtsinformationen.bund.de/path/to/doc)');
    });

    it('removes script and style tags', () => {
      const html = '<script>alert("test")</script><p>Content</p><style>.test{}</style>';
      const result = converter.convertToMarkdown(html);
      expect(result).not.toContain('alert');
      expect(result).not.toContain('.test');
      expect(result).toContain('Content');
    });

    it('handles empty HTML', () => {
      const result = converter.convertToMarkdown('');
      expect(result).toBe('');
    });
  });

  describe('extractMetadata', () => {
    it('extracts common metadata fields', () => {
      const json = {
        title: 'Test Title',
        documentType: 'legislation',
        publicationDate: '2024-01-01',
        eli: 'eli:bund:bgb:2024',
      };
      const metadata = converter.extractMetadata(json);
      expect(metadata.title).toBe('Test Title');
      expect(metadata.type).toBe('legislation');
      expect(metadata.date).toBe('2024-01-01');
      expect(metadata.eli).toBe('eli:bund:bgb:2024');
    });

    it('handles missing fields gracefully', () => {
      const metadata = converter.extractMetadata({});
      expect(metadata.title).toBe('');
      expect(metadata.type).toBe('');
      expect(metadata.date).toBe('');
    });

    it('extracts court information', () => {
      const json = {
        court: { name: 'BGH' },
        fileNumber: 'I ZR 1/23',
        ecli: 'ECLI:DE:BGH:2024:010124UIZR1.23.0',
      };
      const metadata = converter.extractMetadata(json);
      expect(metadata.court).toBe('BGH');
      expect(metadata.fileNumber).toBe('I ZR 1/23');
      expect(metadata.ecli).toBe('ECLI:DE:BGH:2024:010124UIZR1.23.0');
    });
  });

  describe('generateOutline', () => {
    it('generates outline with metadata and preview', () => {
      const json = {
        title: 'Test Document',
        documentType: 'caselaw',
        decisionDate: '2024-01-01',
      };
      const html = '<p>This is the document content that should be previewed.</p>';
      const outline = converter.generateOutline(json, html);
      
      expect(outline).toContain('# Test Document');
      expect(outline).toContain('**Type:** caselaw');
      expect(outline).toContain('**Date:** 2024-01-01');
      expect(outline).toContain('## Preview');
      expect(outline).toContain('This is the document content');
    });

    it('limits preview to 500 characters', () => {
      const json = { title: 'Test' };
      const longText = 'a'.repeat(1000);
      const html = `<p>${longText}</p>`;
      const outline = converter.generateOutline(json, html);
      
      const previewMatch = outline.match(/## Preview\n\n(.+)\.\.\./s);
      expect(previewMatch).toBeTruthy();
      expect(previewMatch![1].length).toBeLessThanOrEqual(500);
    });
  });

  describe('extractSection', () => {
    const html = `
      <h1>Main Title</h1>
      <p>Introduction</p>
      <h2>Section One</h2>
      <p>Content of section one.</p>
      <h2>Section Two</h2>
      <p>Content of section two.</p>
      <h3>Subsection</h3>
      <p>Subsection content.</p>
    `;

    it('extracts section by heading text (case insensitive)', () => {
      const result = converter.extractSection(html, 'section one');
      expect(result).toContain('Section One');
      expect(result).toContain('Content of section one');
      expect(result).not.toContain('Section Two');
    });

    it('extracts section with subsections', () => {
      const result = converter.extractSection(html, 'section two');
      expect(result).toContain('Section Two');
      expect(result).toContain('Content of section two');
      expect(result).toContain('Subsection');
      expect(result).toContain('Subsection content');
    });

    it('returns null for non-existent section', () => {
      const result = converter.extractSection(html, 'nonexistent');
      expect(result).toBeNull();
    });

    it('extracts by article number (§)', () => {
      const articleHtml = '<div data-article="823"><p>§ 823 content</p></div>';
      const result = converter.extractSection(articleHtml, '§ 823');
      expect(result).toContain('823 content');
    });

    it('extracts by article number without § symbol', () => {
      const articleHtml = '<div data-article="823"><p>Content</p></div>';
      const result = converter.extractSection(articleHtml, '823');
      expect(result).toContain('Content');
    });
  });
});
