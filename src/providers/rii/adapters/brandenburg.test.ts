import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { BrandenburgDecisionAdapter } from './brandenburg.js';

describe('BrandenburgDecisionAdapter', () => {
  it('regresses BB search and full-text conversion against HTML samples', async () => {
    const html = await readFile(new URL('./fixtures/bb-decision.html', import.meta.url), 'utf8');
    const adapter = new BrandenburgDecisionAdapter({ get: async (_url, options) => ({ data: options?.params?.input_fulltext ? '<table id="resultlist"><tbody><tr><td>1</td><td>Beschluss</td><td>30.06.2026</td><td><a href="/gerichtsentscheidung/29181">Arzt, ärztliches Attest</a></td><td>OVG Berlin-Brandenburg</td></tr></tbody></table>' : html }) });
    await expect(adapter.search('BB', 'VwVfG', 1)).resolves.toMatchObject([{ id: '29181', date: '30.06.2026', court: 'OVG Berlin-Brandenburg' }]);
    await expect(adapter.get('BB', '29181')).resolves.toMatchObject({ fileNumber: 'OVG 90 H 3/24', ecli: 'ECLI:DE:OVGBEBB:2026:0630.OVG90H3.24.00', content: expect.stringContaining('Die Beschwerde wird zurückgewiesen.') });
  });
});
