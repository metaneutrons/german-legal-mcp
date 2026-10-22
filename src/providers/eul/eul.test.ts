import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { EulConverter } from './converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'tests/fixtures');

describe('EulConverter', () => {
  const converter = new EulConverter();

  describe('with real InfoSoc Directive fixture', () => {
    const html = readFileSync(join(fixturesDir, 'elu-32001L0029.html'), 'utf-8');
    const md = converter.convert(html);

    it('should contain directive title', () => {
      expect(md).toContain('Harmonisierung bestimmter Aspekte des Urheberrechts');
    });

    it('should contain article references', () => {
      expect(md).toContain('Artikel 1');
      expect(md).toContain('Artikel 5');
    });

    it('should contain substantive content', () => {
      expect(md).toContain('Vervielfältigungsrecht');
      expect(md).toContain('öffentliche Wiedergabe');
    });
  });

  describe('with real TFEU Art 267 fixture', () => {
    const html = readFileSync(join(fixturesDir, 'elu-12016E267.html'), 'utf-8');
    const md = converter.convert(html);

    it('should contain article content', () => {
      expect(md).toContain('Vorabentscheidung');
    });

    it('should contain Gerichtshof reference', () => {
      expect(md).toContain('Gerichtshof');
    });
  });

  describe('ELI format rules', () => {
    it('should convert oj-ti-art to heading', () => {
      const html = '<p class="oj-ti-art">Artikel 1</p>';
      expect(converter.convert(html)).toContain('## Artikel 1');
    });

    it('should convert oj-sti-art to subheading', () => {
      const html = '<p class="oj-sti-art">Gegenstand und Ziele</p>';
      expect(converter.convert(html)).toContain('### Gegenstand und Ziele');
    });

    it('should convert section titles', () => {
      const html = '<p class="oj-ti-section-1">KAPITEL I</p>';
      expect(converter.convert(html)).toContain('# KAPITEL I');
    });

    it('puts Official Journal annexes at the top level, keyed on the annex container', () => {
      const html = '<div class="eli-container" id="anx_III">'
        + '<p class="oj-doc-ti">ANNEX III</p><p class="oj-doc-ti">High-risk AI systems</p></div>'
        + '<p class="oj-doc-ti">REGULATION (EU) 2024/1689</p>';
      const md = converter.convert(html);
      expect(md).toContain('# ANNEX III\n');
      expect(md).toContain('## High-risk AI systems');
      expect(md).not.toMatch(/#+ REGULATION/);
    });

    it('converts consolidated-text structure classes', () => {
      const md = converter.convert([
        '<p class="title-division-1">KAPITEL I</p>',
        '<p class="title-division-2">ALLGEMEINE BESTIMMUNGEN</p>',
        '<p class="title-article-norm">Artikel 1</p>',
        '<p class="stitle-article-norm">Gegenstand</p>',
        '<div><p class="title-annex-1">ANHANG X</p><p class="title-annex-1">IT-Großsysteme</p></div>',
        '<p class="title-annex-2">Liste</p>',
      ].join(''));
      expect(md).toContain('# KAPITEL I');
      expect(md).toContain('## ALLGEMEINE BESTIMMUNGEN');
      expect(md).toContain('## Artikel 1');
      expect(md).toContain('### Gegenstand');
      expect(md).toContain('# ANHANG X');
      expect(md).toContain('## IT-Großsysteme');
      expect(md).toContain('## Liste');
    });

    it('reads bare pre-2014 article paragraphs as article headings, nothing else', () => {
      const md = converter.convert('<p>Artikel 5</p><p>Artikel 5 gilt entsprechend.</p><p class="x">Artikel 6</p>');
      expect(md).toContain('## Artikel 5');
      expect(md).not.toContain('## Artikel 5 gilt');
      expect(md).not.toContain('## Artikel 6');
    });

    it('reads bare pre-2014 division paragraphs as top-level headings', () => {
      const md = converter.convert('<p>KAPITEL III</p><p>SCHUTZ VON MASSNAHMEN</p><p>Kapitel III regelt den Schutz.</p>');
      expect(md).toContain('# KAPITEL III');
      expect(md).not.toContain('# Kapitel III regelt');
    });

    it('drops document head text', () => {
      const md = converter.convert('<html><head><title>L_202401689DE.000101.fmx.xml</title>'
        + '<style>body { color: red; }</style></head><body><p>Inhalt</p></body></html>');
      expect(md.trim()).toBe('Inhalt');
    });

    it('should convert footnote tags', () => {
      const html = '<p>Text <span class="oj-super oj-note-tag">1</span></p>';
      expect(converter.convert(html)).toContain('[^1]');
    });
  });
});

// Mock axios at module level
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../../shared/save-to-file.js', () => ({
  saveToFile: vi.fn(async (path: string, content: string, meta?: string) => ({
    content: [{
      type: 'text',
      text: `Saved to ${path} (${content.length} chars)${meta ? `\n\n${meta}` : ''}`,
    }],
  })),
}));

import axios from 'axios';
const mockGet = vi.mocked(axios.get);

describe('EulProvider', () => {
  let eulProvider: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./provider.js');
    eulProvider = new mod.EulProvider();
  });

  it('should return two tools', () => {
    const tools = eulProvider.getTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t: any) => t.name)).toEqual(['eul_search', 'eul_get_document']);
  });

  it('should return error for unknown tool', async () => {
    const result = await eulProvider.handleToolCall('eul_unknown', {});
    expect(result.isError).toBe(true);
  });

  describe('eul_search', () => {
    it('should format SPARQL results', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          results: {
            bindings: [{
              celex: { value: '32001L0029' },
              title: { value: 'Richtlinie 2001/29/EG - Urheberrecht in der Informationsgesellschaft' },
            }],
          },
        },
      } as any);

      const result = await eulProvider.handleToolCall('eul_search', { query: 'Urheberrecht' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('32001L0029');
      expect(result.content[0].text).toContain('Found 1 results');
    });

    it('should handle search errors', async () => {
      mockGet.mockRejectedValueOnce(new Error('SPARQL timeout'));
      await expect(eulProvider.handleToolCall('eul_search', { query: 'test' })).rejects.toThrow('SPARQL timeout');
    });
  });

  describe('eul_get_document', () => {
    it('should convert real InfoSoc fixture', async () => {
      const html = readFileSync(join(fixturesDir, 'elu-32001L0029.html'), 'utf-8');
      mockGet.mockResolvedValueOnce({ data: html } as any);

      const result = await eulProvider.handleToolCall('eul_get_document', { celex: '32001L0029' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Urheberrecht');
      expect(result.content[0].text).toContain('Artikel 1');
    });

    it('should convert real TFEU Art 267 fixture', async () => {
      const html = readFileSync(join(fixturesDir, 'elu-12016E267.html'), 'utf-8');
      mockGet.mockResolvedValueOnce({ data: html } as any);

      const result = await eulProvider.handleToolCall('eul_get_document', { celex: '12016E267' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Vorabentscheidung');
    });

    it('should extract section by line range', async () => {
      mockGet.mockResolvedValueOnce({ data: '<p>Dies ist die erste Zeile mit ausreichend Inhalt für die Validierung.</p><p>Dies ist die zweite Zeile mit weiterem Inhalt.</p>' } as any);

      const result = await eulProvider.handleToolCall('eul_get_document', {
        celex: '32001L0029', section: 'lines:1-1',
      });
      expect(result.isError).toBeUndefined();
    });

    it('should return error for non-existent section', async () => {
      mockGet.mockResolvedValueOnce({ data: '<p>Dies ist ein einfacher Testtext mit ausreichend Zeichen für die Validierung.</p>' } as any);

      const result = await eulProvider.handleToolCall('eul_get_document', {
        celex: '32001L0029', section: 'Art. 999',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('should save to file with save_path', async () => {
      mockGet.mockResolvedValueOnce({ data: '<p>Dies ist ein Testinhalt mit ausreichend Zeichen für die Validierung.</p>' } as any);
      const savePath = resolve('test-output', 'eul.md');

      const result = await eulProvider.handleToolCall('eul_get_document', {
        celex: '32001L0029', save_path: savePath,
      });
      expect(result.content[0].text).toContain(`Saved to ${savePath}`);
      expect(result.content[0].text).toContain('32001L0029');
    });

    const ACT = [
      '<p class="oj-ti-section-1">KAPITEL I</p>',
      '<p class="oj-ti-art">Artikel 1</p><p>Gegenstand dieser Verordnung mit ausreichend Text.</p>',
      '<p class="oj-ti-section-1">KAPITEL II</p>',
      '<p class="oj-ti-art">Artikel 2</p><p class="oj-sti-art">Änderung von Anhang I</p><p>Letzter Artikel.</p>',
      '<div id="anx_I"><p class="oj-doc-ti">ANHANG I</p><p class="oj-doc-ti">Liste</p><p>Erster Anhang.</p></div>',
      '<div id="anx_II"><p class="oj-doc-ti">ANHANG II</p><p>Zweiter Anhang.</p></div>',
      '<div id="anx_III"><p class="oj-doc-ti">ANHANG III</p><p>Dritter Anhang.</p></div>',
    ].join('');

    it('extracts an annex exactly, in any accepted spelling', async () => {
      for (const section of ['Anhang I', 'Anh. I', 'anhang 1', 'Annex I']) {
        mockGet.mockResolvedValueOnce({ data: ACT } as any);
        const result = await eulProvider.handleToolCall('eul_get_document', { celex: '32024R1689', section });
        const text = result.content[0].text as string;
        expect(result.isError).toBeUndefined();
        expect(text).toContain('# ANHANG I\n');
        expect(text).toContain('Erster Anhang.');
        expect(text).not.toContain('Zweiter Anhang.');
        expect(text).not.toContain('Änderung von Anhang I\n\nLetzter');
      }
      mockGet.mockResolvedValueOnce({ data: ACT } as any);
      const third = await eulProvider.handleToolCall('eul_get_document', { celex: '32024R1689', section: 'Anhang III' });
      expect(third.content[0].text).toContain('Dritter Anhang.');
    });

    it('ends an article at the next chapter or at the annexes', async () => {
      mockGet.mockResolvedValueOnce({ data: ACT } as any);
      const first = await eulProvider.handleToolCall('eul_get_document', { celex: '32024R1689', section: 'Art. 1' });
      expect(first.content[0].text).toContain('Gegenstand');
      expect(first.content[0].text).not.toContain('KAPITEL II');

      mockGet.mockResolvedValueOnce({ data: ACT } as any);
      const last = await eulProvider.handleToolCall('eul_get_document', { celex: '32024R1689', section: 'Artikel 2' });
      expect(last.content[0].text).toContain('Letzter Artikel.');
      expect(last.content[0].text).not.toContain('ANHANG I');

      mockGet.mockResolvedValueOnce({ data: ACT } as any);
      const range = await eulProvider.handleToolCall('eul_get_document', { celex: '32024R1689', section: 'Art. 1-2' });
      expect(range.content[0].text).toContain('KAPITEL II');
      expect(range.content[0].text).toContain('Letzter Artikel.');
    });

    const CHAPTERED = [
      '<p class="oj-ti-section-1">KAPITEL II</p><p class="oj-ti-art">Artikel 5</p><p>Verbote.</p>',
      '<p class="oj-ti-section-1">KAPITEL III</p><p class="oj-ti-section-2">HOCHRISIKO</p>',
      '<p class="oj-ti-section-1">ABSCHNITT 1</p><p class="oj-ti-art">Artikel 6</p><p>Einstufung.</p>',
      '<p class="oj-ti-section-1">ABSCHNITT 2</p><p class="oj-ti-art">Artikel 8</p><p>Anforderungen.</p>',
      '<p class="oj-ti-section-1">KAPITEL IV</p><p class="oj-ti-art">Artikel 50</p><p>Transparenz.</p>',
      '<div id="anx_I"><p class="oj-doc-ti">ANHANG I</p><p>Liste der Rechtsakte.</p></div>',
    ].join('');

    it('extracts a chapter with all its sections, up to the next chapter', async () => {
      for (const section of ['Kapitel III', 'kapitel 3', 'Chapter III']) {
        mockGet.mockResolvedValueOnce({ data: CHAPTERED } as any);
        const text = (await eulProvider.handleToolCall('eul_get_document', { celex: '32024R1689', section })).content[0].text as string;
        expect(text).toContain('Einstufung.');
        expect(text).toContain('Anforderungen.');
        expect(text).not.toContain('Transparenz.');
        expect(text).not.toContain('Verbote.');
      }
    });

    it('extracts a section by its path, and the last chapter only up to the annexes', async () => {
      mockGet.mockResolvedValueOnce({ data: CHAPTERED } as any);
      const sectionText = (await eulProvider.handleToolCall('eul_get_document', {
        celex: '32024R1689', section: 'Kapitel III Abschnitt 2',
      })).content[0].text as string;
      expect(sectionText).toContain('Anforderungen.');
      expect(sectionText).not.toContain('Einstufung.');
      expect(sectionText).not.toContain('Transparenz.');

      mockGet.mockResolvedValueOnce({ data: CHAPTERED } as any);
      const last = (await eulProvider.handleToolCall('eul_get_document', {
        celex: '32024R1689', section: 'Kapitel IV',
      })).content[0].text as string;
      expect(last).toContain('Transparenz.');
      expect(last).not.toContain('Liste der Rechtsakte.');

      mockGet.mockResolvedValueOnce({ data: CHAPTERED } as any);
      const missing = await eulProvider.handleToolCall('eul_get_document', {
        celex: '32024R1689', section: 'Kapitel IV Abschnitt 9',
      });
      expect(missing.isError).toBe(true);
    });

    it('states whether the text is the Official Journal or a consolidated version', async () => {
      mockGet.mockResolvedValueOnce({ data: ACT } as any);
      const published = await eulProvider.handleToolCall('eul_get_document', { celex: '32024R1689' });
      expect(published.content[0].text).toContain('as published in the Official Journal');

      mockGet.mockResolvedValueOnce({ data: ACT } as any);
      const consolidated = await eulProvider.handleToolCall('eul_get_document', {
        celex: '02024R1689-20240712', section: 'Anhang II',
      });
      expect(consolidated.content[0].text).toContain('Consolidated version as of 2024-07-12');
      expect(consolidated.content[0].text).toContain('Zweiter Anhang.');
    });

    it('never returns an AWS WAF challenge page as the document', async () => {
      mockGet.mockResolvedValueOnce({
        status: 202,
        headers: { 'x-amzn-waf-action': 'challenge' },
        data: '<html><head><script>window.gokuProps = {};</script></head><body>Please wait while we verify your browser, long enough text.</body></html>',
      } as any);
      await expect(eulProvider.handleToolCall('eul_get_document', { celex: '32024R1689' }))
        .rejects.toMatchObject({ code: 'UPSTREAM_BOT_CHALLENGE' });
    });

    it('should handle fetch errors', async () => {
      mockGet.mockRejectedValueOnce(new Error('404 Not Found'));
      await expect(eulProvider.handleToolCall('eul_get_document', { celex: '32000R0001' })).rejects.toThrow('404');
    });
  });
});
