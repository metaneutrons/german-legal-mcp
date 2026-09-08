import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isAxiosError: (e: any) => e?.isAxiosError === true,
  },
}));

import axios from 'axios';
const mockPost = vi.mocked(axios.post);

/** The `/init` handshake every call goes through before it can search. */
function mockSession() {
  mockPost.mockResolvedValueOnce({
    headers: { 'set-cookie': ['JSESSIONID=abc123; Path=/'] },
    data: { csrfToken: 'csrf-1', user: { login: 'BuergerserviceHA2021' } },
  } as never);
}

/**
 * A `resultList` entry captured live from the Hamburg portal. The positional
 * packing is the whole point of the test, so every field the mapping reads is
 * kept verbatim rather than simplified.
 *
 * One field is deliberately dropped rather than reproduced: the entry also
 * carries `entryType` naming the R3 backend vendor, whose value trips the
 * private-provider scanner that gates the public export. Nothing here reads it,
 * so omitting it is cheaper than widening that guard — please do not add it
 * back.
 */
const AUTHENTIC_HIT = {
  inaccessible: false,
  snippetList: [['beim deliktischen ', 'Schadensersatz', ' im sogenannten „Abgasskandal“']],
  titleList: ['Hanseatisches Oberlandesgericht Hamburg 15. Zivilsenat', '15 U 190/19'],
  subtitleList: [
    'Beschluss',
    'Abzug von Nutzungsvorteilen beim deliktischen Schadensersatz im sogenannten „Abgasskandal“',
    '§ 249 Abs 1 BGB, § 826 BGB',
  ],
  categoryId: 'Rechtsprechung',
  date: '13.01.2020',
  docId: 'NJRE001359408',
  docPart: 'L',
};

describe('jportalDecisionSearch result mapping', () => {
  beforeEach(() => vi.clearAllMocks());

  async function search(hit: Record<string, unknown>, state: string) {
    // Fresh module per test: sessions are cached in module scope, so reusing
    // the import would skip the handshake the next test's mock queue expects.
    vi.resetModules();
    const { jportalDecisionSearch } = await import('./jportal.js');
    mockSession();
    mockPost.mockResolvedValueOnce({ data: { resultList: [hit], hits: 2148 } } as never);
    return jportalDecisionSearch(state, 'Schadensersatz', 1);
  }

  it('reads court and file number out of the positional titleList', async () => {
    const page = await search(AUTHENTIC_HIT, 'HH');
    expect(page.results[0]).toMatchObject({
      docId: 'NJRE001359408',
      court: 'Hanseatisches Oberlandesgericht Hamburg 15. Zivilsenat',
      fileNumber: '15 U 190/19',
    });
  });

  it('titles the hit with its subject, not with the court name', async () => {
    const page = await search(AUTHENTIC_HIT, 'BW');
    // Regression guard: `titleList[0]` is the court. Using it as the title is
    // what left the court and az columns empty across all ten portals.
    expect(page.results[0]?.title)
      .toBe('Abzug von Nutzungsvorteilen beim deliktischen Schadensersatz im sogenannten „Abgasskandal“');
    expect(page.results[0]?.title).not.toBe(AUTHENTIC_HIT.titleList[0]);
  });

  it('keeps the decision type and cited norms in the subtitle for scoring', async () => {
    const page = await search(AUTHENTIC_HIT, 'HE');
    expect(page.results[0]?.subtitle).toContain('Beschluss');
    expect(page.results[0]?.subtitle).toContain('§ 249 Abs 1 BGB');
  });

  it('degrades to a thinner row when a portal returns fewer parts', async () => {
    const page = await search(
      { ...AUTHENTIC_HIT, titleList: ['Amtsgericht Hamburg'], subtitleList: ['Urteil'] },
      'SH',
    );
    // No second titleList entry means no file number to report — but the title
    // must not come back empty, so it falls through to what is available.
    expect(page.results[0]).toMatchObject({ court: 'Amtsgericht Hamburg', title: 'Urteil' });
    expect(page.results[0]).not.toHaveProperty('fileNumber');
  });

  it('omits court entirely when titleList is empty', async () => {
    const page = await search({ ...AUTHENTIC_HIT, titleList: [] }, 'TH');
    expect(page.results[0]).not.toHaveProperty('court');
    expect(page.results[0]).not.toHaveProperty('fileNumber');
  });

  it('trims whitespace the portal pads fields with', async () => {
    const page = await search(
      { ...AUTHENTIC_HIT, titleList: ['  LAG Hamburg 2. Kammer  ', '  5 Sa 12/24 '] },
      'MV',
    );
    expect(page.results[0]).toMatchObject({
      court: 'LAG Hamburg 2. Kammer',
      fileNumber: '5 Sa 12/24',
    });
  });
});
