import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { NRWDecisionAdapter } from './nrw.js';

const fixture = new URL('./fixtures/nrw-decision.html', import.meta.url);

describe('NRWDecisionAdapter', () => {
  it('parses authentic NRWE-shaped search and decision HTML', async () => {
    const html = await readFile(fixture, 'utf8');
    const http = {
      post: vi.fn(async () => ({ data: '<div class="einErgebnis"><a href="https://nrwe.justiz.nrw.de/example.html">8 K 3077/09 - Verwaltungsgericht Arnsberg</a><br />Gericht: Verwaltungsgericht Arnsberg <br />Entscheidungsart: Urteil <br />Aktenzeichen: 8 K 3077/09 <br />ECLI:DE:VGAR:2010:1214.8K3077.09.00<br />Entscheidungsdatum: 14.12.2010<br /></div>' })),
      get: vi.fn(async () => ({ data: html })),
    };
    const adapter = new NRWDecisionAdapter(http);
    await expect(adapter.search('NW', 'VwVfG', 1)).resolves.toMatchObject([{
      fileNumber: '8 K 3077/09',
      court: 'Verwaltungsgericht Arnsberg',
      ecli: 'ECLI:DE:VGAR:2010:1214.8K3077.09.00',
    }]);
    await expect(adapter.get('NW', 'https://nrwe.justiz.nrw.de/example.html')).resolves.toMatchObject({ court: 'Verwaltungsgericht Arnsberg', ecli: 'ECLI:DE:VGAR:2010:1214.8K3077.09.00', content: expect.stringContaining('Die Klage wird abgewiesen.') });
  });
});
