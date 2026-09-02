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

    it('should handle fetch errors', async () => {
      mockGet.mockRejectedValueOnce(new Error('404 Not Found'));
      await expect(eulProvider.handleToolCall('eul_get_document', { celex: '32000R0001' })).rejects.toThrow('404');
    });
  });
});
