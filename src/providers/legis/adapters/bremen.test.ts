import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => ({ mockAxios: { get: vi.fn(), post: vi.fn() } }));
vi.mock('axios', () => ({ default: mockAxios }));

import { BremenAdapter } from './bremen.js';

beforeEach(() => mockAxios.get.mockReset());

describe('BremenAdapter', () => {
  it('parses metainformation links into search results', async () => {
    mockAxios.get.mockResolvedValue({
      data: '<h2 class="inhaltsseiten"><a href="https://www.transparenz.bremen.de/metainformationen/bremisches-informationsfreiheitsgesetz-12345">Bremisches Informationsfreiheitsgesetz</a></h2>',
    });

    const results = await new BremenAdapter().search('HB', 'informationsfreiheit', 10);

    expect(results).toEqual([
      {
        id: 'https://www.transparenz.bremen.de/metainformationen/bremisches-informationsfreiheitsgesetz-12345',
        title: 'Bremisches Informationsfreiheitsgesetz',
        subtitle: '',
        date: '',
      },
    ]);
  });

  it('renders a document to markdown', async () => {
    mockAxios.get.mockResolvedValue({
      data: '<html><head><title>Gesetz X - Transparenzportal Bremen</title></head><body>'
        + '<div class="main_article gesetz"><h2>§ 1 Zweck</h2><p>Inhalt.</p></div></body></html>',
      request: {},
    });

    const entry = await new BremenAdapter().get(
      'HB',
      'https://www.transparenz.bremen.de/metainformationen/gesetz-x-12345',
    );

    expect(entry.title).toBe('Gesetz X');
    expect(entry.content).toContain('§ 1 Zweck');
    expect(entry.content).toContain('Inhalt');
    const requestedUrl = new URL(String(mockAxios.get.mock.calls[0]?.[0]));
    expect(requestedUrl.pathname).toBe('/metainformationen/gesetz-x-12345');
    expect(requestedUrl.searchParams.get('asl')).toBe('bremen203_tpgesetz.c.55340.de');
    expect(requestedUrl.searchParams.get('template')).toBe('20_gp_ifg_meta_detail_d');
  });

  it.each([
    'http://www.transparenz.bremen.de/metainformationen/gesetz-x-12345',
    'https://127.0.0.1/private',
    'https://192.168.1.10/private',
    'https://169.254.169.254/latest/meta-data/',
    'https://user:secret@www.transparenz.bremen.de/metainformationen/gesetz-x-12345',
    'https://www.transparenz.bremen.de/metainformationen/%2e%2e/private',
  ])('rejects unsafe document URL %s before Axios dispatch', async (id) => {
    await expect(new BremenAdapter().get('HB', id)).rejects.toThrow(/network policy/);
    expect(mockAxios.get).not.toHaveBeenCalled();
  });
});
