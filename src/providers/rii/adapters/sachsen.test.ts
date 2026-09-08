import { describe, expect, it } from 'vitest';
import { SachsenDecisionAdapter } from './sachsen.js';

const initial = `<form id="SlForm"><input type="hidden" name="__VIEWSTATE" value="state" /></form>`;
const result = `<form id="SlForm"><table id="DV16_Table"><tbody><tr><td></td><td>09.07.2026</td><td><span title="Leitsatz: Vertragliche Rückabwicklung">4 U 108/26</span></td><td>Oberlandesgericht Dresden</td><td><input type="submit" name="DV16_Table$ctl02$DV16_Table_Col3_C1" value="4U108-26..." /></td></tr></tbody></table></form>`;
const detail = `<html><body><h1>4 U 108/26</h1><div id="DV1_C40"><p>Vertragliche Rückabwicklung.</p></div></body></html>`;

describe('SachsenDecisionAdapter', () => {
  it('parses WebForms result rows and performs the opaque postback on get', async () => {
    let posts = 0;
    const adapter = new SachsenDecisionAdapter({ get: async () => ({ data: initial }), post: async (_url, body) => { posts++; return { data: posts === 1 ? result : detail, body }; } });
    const [hit] = await adapter.search('SN', 'Vertrag', 10);
    expect(hit).toMatchObject({ fileNumber: '4 U 108/26', court: 'Oberlandesgericht Dresden' });
    const entry = await adapter.get('SN', hit.id);
    expect(entry.content).toContain('Vertragliche Rückabwicklung');
    expect(posts).toBe(2);
  });

  it('uses the current-decision table without submitting an empty search', async () => {
    let posts = 0;
    const adapter = new SachsenDecisionAdapter({
      get: async () => ({ data: result }),
      post: async () => { posts++; return { data: detail }; },
    });

    const [hit] = await adapter.search('SN', '', 1);
    expect(hit).toMatchObject({ fileNumber: '4 U 108/26' });
    expect(posts).toBe(0);

    const entry = await adapter.get('SN', hit.id);
    expect(entry.content).toContain('Vertragliche Rückabwicklung');
    expect(posts).toBe(1);
  });

  it('falls back to the landing page when the search post fails', async () => {
    // The search endpoint has a history of 504s and timeouts. That failing must
    // degrade to the current-decision table rather than propagate.
    const adapter = new SachsenDecisionAdapter({
      get: async () => ({ data: result }),
      post: async () => { throw Object.assign(new Error('timeout of 6000ms exceeded'), { code: 'ECONNABORTED' }); },
    });
    // The fallback path needle-filters, so the query has to match the table.
    await expect(adapter.search('SN', 'Rückabwicklung', 10))
      .resolves.toMatchObject([{ fileNumber: '4 U 108/26' }]);
  });

  it('names the landing page when that is the request that failed', async () => {
    const adapter = new SachsenDecisionAdapter({
      get: async () => { throw Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' }); },
      post: async () => ({ data: result }),
    });
    // A bare "timeout of Nms exceeded" could not be told apart from the search
    // post timing out, which is an entirely different diagnosis.
    await expect(adapter.search('SN', 'Vertrag', 10))
      .rejects.toThrow(/Sachsen landing page did not load within 8000ms/);
  });
});
