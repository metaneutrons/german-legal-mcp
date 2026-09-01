import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IcuConverter } from './converter.js';
import { IcuUnavailableError } from './errors.js';

describe('IcuConverter', () => {
  const converter = new IcuConverter();

  it('should convert Randnummern', () => {
    const html = '<P><A NAME="point1">1</A> Das Vorabentscheidungsersuchen betrifft</P>';
    const md = converter.convert(html);
    expect(md).toContain('[Rn. 1]{.rn}');
    expect(md).toContain('Das Vorabentscheidungsersuchen betrifft');
  });

  it('should convert multiple Randnummern', () => {
    const html = `
      <P><A NAME="point1">1</A> Erster Absatz.</P>
      <P><A NAME="point2">2</A> Zweiter Absatz.</P>
    `;
    const md = converter.convert(html);
    expect(md).toContain('[Rn. 1]{.rn}');
    expect(md).toContain('[Rn. 2]{.rn}');
  });

  it('should convert footnote references', () => {
    const html = '<P>Text (<A HREF="#Footnote1" NAME="Footref1">1</A>)</P>';
    const md = converter.convert(html);
    expect(md).toContain('[^1]');
  });

  it('should convert footnote definitions', () => {
    const html = '<P><A HREF="#Footref1" NAME="Footnote1">1</A> Verfahrenssprache: Deutsch.</P>';
    const md = converter.convert(html);
    expect(md).toContain('[^1]:');
  });

  it('should handle plain HTML without special elements', () => {
    const html = '<P>Ein einfacher Absatz.</P>';
    const md = converter.convert(html);
    expect(md).toContain('Ein einfacher Absatz.');
  });
});

// Mock axios at module level so it gets hoisted
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
const mockPost = vi.mocked(axios.post);
const mockGet = vi.mocked(axios.get);

describe('IcuProvider', () => {
  let icuProvider: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./provider.js');
    icuProvider = new mod.IcuProvider();
  });

  it('should return two tools', () => {
    const tools = icuProvider.getTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t: any) => t.name)).toEqual(['icu_search', 'icu_get_document']);
  });

  it('should return error for unknown tool', async () => {
    const result = await icuProvider.handleToolCall('icu_unknown', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  describe('icu_search', () => {
    it('should format search results', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          totalHits: 1,
          searchHits: [{
            content: {
              docType: 'Arrêt', docDate: '2019-07-29', idPublished: 'C-476/17',
              ecli: 'ECLI:EU:C:2019:624', celex: '62017CJ0476',
              affairJurisdiction: 'Gerichtshof', logicDocId: 'id_216552',
            },
          }],
        },
      } as any);

      const result = await icuProvider.handleToolCall('icu_search', { query: 'Pelham' });
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('Found 1 results');
      expect(text).toContain('C-476/17');
      expect(text).toContain('ECLI:EU:C:2019:624');
      expect(text).toContain('id_216552');
    });

    it('should handle search errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('Network error'));
      await expect(icuProvider.handleToolCall('icu_search', { query: 'test' })).rejects.toThrow('Network error');
    });

    it('classifies Curia maintenance HTML returned as 403 as recoverable', async () => {
      const error = Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: {
          status: 403,
          data: '<html><title>curia.europa.eu</title><body>The site is temporarily unavailable</body></html>',
        },
      });
      mockPost.mockRejectedValueOnce(error);

      await expect(icuProvider.handleToolCall('icu_search', { query: 'test' }))
        .rejects.toBeInstanceOf(IcuUnavailableError);
    });

    it('does not classify an unrelated 403 as an InfoCuria outage', async () => {
      const error = Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: { status: 403, data: '<html><body>Forbidden</body></html>' },
      });
      mockPost.mockRejectedValueOnce(error);

      await expect(icuProvider.handleToolCall('icu_search', { query: 'test' }))
        .rejects.toBe(error);
    });
  });

  describe('icu_get_document', () => {
    it('should resolve id_ prefix directly', async () => {
      mockGet.mockResolvedValueOnce({ data: '<P><A NAME="point1">1</A> Dies ist ein Testinhalt mit ausreichend Zeichen für die Validierung.</P>' } as any);

      const result = await icuProvider.handleToolCall('icu_get_document', { case_id: 'id_216552' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('[Rn. 1]{.rn}');
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/216552/DE/html'),
        expect.any(Object),
      );
    });

    it('should resolve numeric ID', async () => {
      mockGet.mockResolvedValueOnce({ data: '<P>Dies ist ein Testinhalt mit ausreichend Zeichen für die Validierung.</P>' } as any);

      await icuProvider.handleToolCall('icu_get_document', { case_id: '216552' });
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/216552/DE/html'),
        expect.any(Object),
      );
    });

    it('should search for case number', async () => {
      mockPost.mockResolvedValueOnce({
        data: { searchHits: [{ content: { logicDocId: 'id_216552' } }] },
      } as any);
      mockGet.mockResolvedValueOnce({ data: '<P>Dies ist ein Testurteil mit ausreichend Zeichen für die Validierung.</P>' } as any);

      await icuProvider.handleToolCall('icu_get_document', { case_id: 'C-476/17' });
      // The published number is converted to its CELEX form and searched for —
      // passing it as publishedId is silently ignored by InfoCuria.
      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ searchTerm: '62017CJ0476' }),
        expect.any(Object),
      );
    });

    it('should search by CELEX number', async () => {
      mockPost.mockResolvedValueOnce({
        data: { searchHits: [{ content: { logicDocId: 'id_216552' } }] },
      } as any);
      mockGet.mockResolvedValueOnce({ data: '<P>Dies ist ein Testurteil mit ausreichend Zeichen für die Validierung.</P>' } as any);

      await icuProvider.handleToolCall('icu_get_document', { case_id: '62017CJ0476' });
      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ searchTerm: '62017CJ0476' }),
        expect.any(Object),
      );
    });

    it('should return error when document not found', async () => {
      // Both candidates are tried — judgment code first, then order.
      mockPost.mockResolvedValue({ data: { searchHits: [] } } as any);

      const result = await icuProvider.handleToolCall('icu_get_document', { case_id: 'C-999/99' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No document found');
    });

    it('should extract section by Rn range', async () => {
      mockGet.mockResolvedValueOnce({
        data: `
          <P><A NAME="point1">1</A> First paragraph.</P>
          <P><A NAME="point2">2</A> Second paragraph.</P>
          <P><A NAME="point3">3</A> Third paragraph.</P>
        `,
      } as any);

      const result = await icuProvider.handleToolCall('icu_get_document', {
        case_id: 'id_123', section: 'Rn 1-2',
      });
      expect(result.content[0].text).toContain('[Rn. 1]{.rn}');
      expect(result.content[0].text).toContain('[Rn. 2]{.rn}');
      expect(result.content[0].text).not.toContain('[Rn. 3]{.rn}');
    });

    it('should return error for non-existent section', async () => {
      mockGet.mockResolvedValueOnce({ data: '<P>Dies ist ein einfacher Testtext mit ausreichend Zeichen für die Validierung.</P>' } as any);

      const result = await icuProvider.handleToolCall('icu_get_document', {
        case_id: 'id_123', section: 'Rn 99',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('should save to file with save_path', async () => {
      mockGet.mockResolvedValueOnce({ data: '<P>Dies ist ein Testinhalt mit ausreichend Zeichen für die Validierung.</P>' } as any);

      const result = await icuProvider.handleToolCall('icu_get_document', {
        case_id: 'id_123', save_path: '/tmp/test.md',
      });
      expect(result.content[0].text).toContain('Saved to /tmp/test.md');
    });
  });
});
