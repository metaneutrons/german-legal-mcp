import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => ({ mockAxios: { get: vi.fn(), post: vi.fn() } }));
vi.mock('axios', () => ({ default: mockAxios }));

import { SachsenAdapter } from './sachsen.js';

beforeEach(() => { mockAxios.get.mockReset(); mockAxios.post.mockReset(); });

describe('SachsenAdapter', () => {
  it('fetches a CSRF token then parses Vorschrift links from the results', async () => {
    mockAxios.get.mockResolvedValue({
      data: '<input name="authenticity_token" value="tok-123">',
      headers: { 'set-cookie': ['_session=abc; Path=/; HttpOnly'] },
    });
    mockAxios.post.mockResolvedValue({
      data: '<a href="/vorschrift/SaechsBO">Sächsische Bauordnung</a>'
        + '<a href="/vorschrift/suche">ignored search link</a>',
    });

    const results = await new SachsenAdapter().search('SN', 'bauordnung', 10);

    expect(results).toEqual([
      { id: 'SaechsBO', title: 'Sächsische Bauordnung', subtitle: '', date: '' },
    ]);
    // The CSRF token and cookie were forwarded to the search POST.
    const [, body, cfg] = mockAxios.post.mock.calls[0];
    expect(body).toContain('tok-123');
    expect(cfg.headers.Cookie).toBe('_session=abc');
  });

  it('renders a Vorschrift to markdown, stripping navigation', async () => {
    mockAxios.get.mockResolvedValue({
      data: '<h1>Bauordnung</h1>'
        + '<div class="law_show"><nav>menu</nav><h2>§ 1 Zweck</h2><p>Inhalt.</p></div>',
    });

    const entry = await new SachsenAdapter().get('SN', 'SaechsBO');

    expect(entry.title).toBe('Bauordnung');
    expect(entry.content).toContain('§ 1 Zweck');
    expect(entry.content).toContain('Inhalt');
    expect(entry.content).not.toContain('menu');
    expect(entry.url).toContain('/vorschrift/SaechsBO');
  });
});
