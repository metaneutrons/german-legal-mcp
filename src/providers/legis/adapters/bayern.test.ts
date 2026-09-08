import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => ({ mockAxios: { get: vi.fn(), post: vi.fn() } }));
vi.mock('axios', () => ({ default: mockAxios }));

import { BayernAdapter } from './bayern.js';

beforeEach(() => { mockAxios.get.mockReset(); mockAxios.post.mockReset(); });

describe('BayernAdapter', () => {
  it('parses document links from the search results, skipping chrome links', async () => {
    mockAxios.get.mockResolvedValue({
      data: '<input name="__RequestVerificationToken" value="rvt-1">',
      headers: { 'set-cookie': ['ai=1; Path=/'] },
    });
    mockAxios.post.mockResolvedValue({
      data: '<a href="/Content/Document/BayBO/true">Bayerische Bauordnung</a>'
        + '<a href="/Content/Document/Impressum">Impressum</a>',
    });

    const results = await new BayernAdapter().search('BY', 'bauordnung', 10);

    expect(results).toEqual([
      { id: 'BayBO', title: 'Bayerische Bauordnung', subtitle: '', date: '' },
    ]);
  });

  it('renders a document, dropping the navigation tree', async () => {
    mockAxios.get.mockResolvedValue({
      data: '<title>Bayerische Bauordnung - Bürgerservice</title>'
        + '<div class="tree">nav</div><div class="cont"><h2>Art. 1</h2><p>Text.</p></div>',
    });

    const entry = await new BayernAdapter().get('BY', 'BayBO');

    expect(entry.title).toBe('Bayerische Bauordnung');
    expect(entry.content).toContain('Art. 1');
    expect(entry.content).not.toContain('nav');
  });
});
