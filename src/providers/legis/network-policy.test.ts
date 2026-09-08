import { describe, expect, it } from 'vitest';
import { assertUrlAllowed } from '../../shared/network-policy.js';
import {
  LEGIS_BAYERN_POLICY,
  LEGIS_BRANDENBURG_POLICY,
  LEGIS_NRW_POLICY,
} from './network-policy.js';

describe('legislation network policies', () => {
  it('admits only the exact Bayern and Brandenburg search-result redirects', () => {
    expect(assertUrlAllowed(
      'https://www.gesetze-bayern.de/Search/Hitlist',
      LEGIS_BAYERN_POLICY,
    ).pathname).toBe('/Search/Hitlist');
    expect(assertUrlAllowed(
      'https://bravors.brandenburg.de/de/vorschriften_schnellsuche/ergebnis',
      LEGIS_BRANDENBURG_POLICY,
    ).pathname).toBe('/de/vorschriften_schnellsuche/ergebnis');
    expect(() => assertUrlAllowed(
      'https://bravors.brandenburg.de/de/vorschriften_schnellsuche/admin',
      LEGIS_BRANDENBURG_POLICY,
    )).toThrow(/rejected path/i);
  });

  it('accepts canonical NRW law slugs with or without their trailing slash', () => {
    const base = 'https://recht.nrw.de/lrgv/gesetz/current-law';
    expect(assertUrlAllowed(base, LEGIS_NRW_POLICY).pathname)
      .toBe('/lrgv/gesetz/current-law');
    expect(assertUrlAllowed(`${base}/`, LEGIS_NRW_POLICY).pathname)
      .toBe('/lrgv/gesetz/current-law/');
    expect(() => assertUrlAllowed(
      'https://recht.nrw.de/admin/current-law/',
      LEGIS_NRW_POLICY,
    )).toThrow(/rejected path/i);
  });
});
