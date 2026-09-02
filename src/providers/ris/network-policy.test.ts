import { describe, expect, it, vi } from 'vitest';
import { assertUrlAllowed, safeAxiosGet } from '../../shared/network-policy.js';
import { RIS_DOCUMENT_POLICY } from './network-policy.js';

describe('RIS document network policy', () => {
  it('admits only the whole-law path on the OGD and redirect origins', () => {
    for (const hostname of ['ogd.ris.bka.gv.at', 'ris.bka.gv.at']) {
      expect(assertUrlAllowed(
        `https://${hostname}/GeltendeFassung.wxe?Abfrage=Bundesnormen`,
        RIS_DOCUMENT_POLICY,
      ).hostname).toBe(hostname);
      expect(() => assertUrlAllowed(
        `https://${hostname}/Dokumente/private.html`,
        RIS_DOCUMENT_POLICY,
      )).toThrow(/rejected path/i);
    }
  });

  it('follows the reviewed OGD-to-RIS redirect but rejects an unlisted host', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({
        status: 301,
        headers: { location: 'https://ris.bka.gv.at/GeltendeFassung.wxe?x=1' },
      })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: '<html />' });

    await expect(safeAxiosGet(
      { get },
      'https://ogd.ris.bka.gv.at/GeltendeFassung.wxe?x=1',
      RIS_DOCUMENT_POLICY,
    )).resolves.toMatchObject({ status: 200 });
    expect(get).toHaveBeenCalledTimes(2);

    get.mockReset();
    get.mockResolvedValueOnce({
      status: 301,
      headers: { location: 'https://example.com/GeltendeFassung.wxe' },
    });
    await expect(safeAxiosGet(
      { get },
      'https://ogd.ris.bka.gv.at/GeltendeFassung.wxe?x=1',
      RIS_DOCUMENT_POLICY,
    )).rejects.toThrow(/rejected host/i);
  });
});
