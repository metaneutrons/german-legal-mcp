import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => ({ mockAxios: { get: vi.fn(), post: vi.fn() } }));
vi.mock('axios', () => ({ default: mockAxios }));

import { searchBayern, fetchBayernDecision } from './client.js';

beforeEach(() => { mockAxios.get.mockReset(); mockAxios.post.mockReset(); });

describe('rii bayern client', () => {
  it('opens a session then parses Y- decision links, honouring the limit', async () => {
    mockAxios.get.mockResolvedValue({
      data: '<input name="__RequestVerificationToken" value="rvt">',
      headers: { 'set-cookie': ['sess=1; Path=/'] },
    });
    mockAxios.post.mockResolvedValue({
      data:
        '<div><a class="hltitel" href="/Content/Document/Y-300-Z-BECKRS-2020-1">BayObLG Beschluss</a>'
        + '<p class="hlSubTitel">Leitsatz hier</p></div>'
        + '<div><a class="hltitel" href="/Content/Document/Y-300-Z-BECKRS-2020-2">Zweiter</a></div>'
        + '<a class="hltitel" href="/Content/Document/NotY-1">ignored, not a decision</a>',
    });

    const page = await searchBayern('mietrecht', 1);

    expect(page.results).toEqual([
      { title: 'BayObLG Beschluss', docId: 'Y-300-Z-BECKRS-2020-1', subtitle: 'Leitsatz hier' },
    ]);
    // The CSRF token + cookie from the session were sent with the search POST.
    const [, body, cfg] = mockAxios.post.mock.calls[0];
    expect(body).toContain('rvt');
    expect(cfg.headers.Cookie).toBe('sess=1');
  });

  it('fetches raw decision HTML by document id', async () => {
    mockAxios.get.mockResolvedValue({ data: '<html>decision</html>' });
    await expect(fetchBayernDecision('Y-300-Z-BECKRS-2020-1')).resolves.toBe('<html>decision</html>');
  });
});
