import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => ({ mockAxios: { get: vi.fn(), post: vi.fn() } }));
vi.mock('axios', () => ({ default: mockAxios }));

import { BrandenburgAdapter } from './brandenburg.js';

beforeEach(() => { mockAxios.get.mockReset(); mockAxios.post.mockReset(); });

describe('BrandenburgAdapter', () => {
  it('keeps only Vorschrift links (gesetze/verordnungen/...) from the results', async () => {
    mockAxios.get.mockResolvedValue({ data: '', headers: { 'set-cookie': ['c=1; Path=/'] } });
    mockAxios.post.mockResolvedValue({
      data: '<a href="/gesetze/bbgnatschg">Brandenburgisches Naturschutzausführungsgesetz (BbgNatSchAG)</a>'
        + '<a href="/gesetze/list">list ignored</a>'
        + '<a href="/impressum">chrome ignored</a>',
    });

    const results = await new BrandenburgAdapter().search('BB', 'naturschutz', 10);

    expect(results).toEqual([
      {
        id: 'gesetze/bbgnatschg',
        title: 'Brandenburgisches Naturschutzausführungsgesetz (BbgNatSchAG)',
        subtitle: '',
        date: '',
      },
    ]);
  });

  it('tries Brandenburg abbreviation suffix aliases', async () => {
    mockAxios.get.mockResolvedValue({ data: '', headers: { 'set-cookie': ['c=1; Path=/'] } });
    mockAxios.post
      .mockResolvedValueOnce({ data: '' })
      .mockResolvedValueOnce({
        data: '<a href="/gesetze/vwvfgbbg">Verwaltungsverfahrensgesetz für das Land Brandenburg (VwVfGBbg)</a>',
      })
      .mockResolvedValueOnce({ data: '' });

    const results = await new BrandenburgAdapter().search('BB', 'BbgVwVfG', 10);

    expect(mockAxios.post).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.stringContaining('VwVfGBbg'),
      expect.any(Object),
    );
    expect(results[0]).toEqual({
      id: 'gesetze/vwvfgbbg',
      title: 'Verwaltungsverfahrensgesetz für das Land Brandenburg (VwVfGBbg)',
      subtitle: '',
      date: '',
    });
  });

  it('renders a document to markdown', async () => {
    mockAxios.get.mockResolvedValue({
      data: '<title>BbgNatSchG</title>'
        + '<div class="services">x</div>'
        + '<div class="reiterbox_innen_2"><h2>§ 1</h2><p>Schutz.</p></div>',
    });

    const entry = await new BrandenburgAdapter().get('BB', 'gesetze/bbgnatschg');

    expect(entry.title).toBe('BbgNatSchG');
    expect(entry.content).toContain('§ 1');
    expect(entry.content).toContain('Schutz');
    expect(entry.content).not.toContain('x');
  });
});
