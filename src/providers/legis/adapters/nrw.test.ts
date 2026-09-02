import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => ({
  mockAxios: { post: vi.fn(), get: vi.fn() },
}));

vi.mock('axios', () => ({ default: mockAxios }));

import { NRWAdapter } from './nrw.js';

beforeEach(() => {
  mockAxios.post.mockReset();
  mockAxios.get.mockReset();
});

describe('NRWAdapter', () => {
  it('ranks current catalog hits locally using short title and long title metadata', async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        hits: {
          hits: [
            {
              _id: 'entity:node/999:de',
              _source: {
                field_long_title: ['Vergabeverordnung NRW'],
                field_short_title: ['VergabeVO NRW'],
                field_document_type_name: ['Rechtsverordnung'],
              },
            },
            {
              _id: 'entity:node/123:de',
              _source: {
                field_long_title: ['Verwaltungsverfahrensgesetz für das Land Nordrhein-Westfalen'],
                field_short_title: ['VwVfG NRW'],
                field_document_type_name: ['Gesetz'],
              },
            },
          ],
        },
      },
    });

    const results = await new NRWAdapter().search('NW', 'VwVfG NRW', 10);

    expect(mockAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        size: 100,
        query: {
          function_score: {
            functions: expect.any(Array),
            query: {
              bool: {
                must: expect.arrayContaining([
                  { terms: { type: ['state_law_and_regulations', 'state_law_ministerial_gazette'] } },
                ]),
              },
            },
          },
        },
      }),
      expect.any(Object),
    );
    expect(results).toEqual([{
      id: '123',
      title: 'Verwaltungsverfahrensgesetz für das Land Nordrhein-Westfalen',
      subtitle: 'VwVfG NRW',
      date: 'Gesetz',
    }]);
  });

  it('maps body fields into a table of contents', async () => {
    mockAxios.post.mockResolvedValue({
      data: { hits: { hits: [{ _source: { field_body_field_num: ['§ 1', '§ 2'], field_body_field_headline: ['Zweck', 'Geltung'] } }] } },
    });

    const toc = await new NRWAdapter().toc('NW', '123');

    expect(toc).toEqual([
      { depth: 1, num: '§ 1', title: 'Zweck' },
      { depth: 1, num: '§ 2', title: 'Geltung' },
    ]);
  });

  it('throws when the law is not found', async () => {
    mockAxios.post.mockResolvedValue({ data: { hits: { hits: [] } } });
    await expect(new NRWAdapter().toc('NW', '999')).rejects.toThrow(/not found/i);
  });

  it('renders article HTML to markdown', async () => {
    mockAxios.get.mockResolvedValue({
      data: '<html><head><title>Umweltgesetz | RECHT.NRW.DE</title></head><body>'
        + '<div class="paragraph--type--article"><h2>§ 1 Zweck</h2><p>Schutz der Umwelt.</p></div></body></html>',
      request: {},
    });

    const entry = await new NRWAdapter().get('NW', 'umwg'); // slug id -> /lrgv/umwg (no lookup)

    expect(entry.title).toBe('Umweltgesetz');
    expect(entry.content).toContain('§ 1 Zweck');
    expect(entry.content).toContain('Schutz der Umwelt');
  });
});
