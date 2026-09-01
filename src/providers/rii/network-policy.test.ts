import { describe, expect, it } from 'vitest';
import { assertUrlAllowed } from '../../shared/network-policy.js';
import { RII_BAYERN_POLICY, RII_BREMEN_POLICY } from './network-policy.js';

describe('RII network policies', () => {
  it('admits the exact Bayern result redirect but no adjacent path', () => {
    expect(assertUrlAllowed(
      'https://www.gesetze-bayern.de/Search/Hitlist',
      RII_BAYERN_POLICY,
    ).pathname).toBe('/Search/Hitlist');
    expect(() => assertUrlAllowed(
      'https://www.gesetze-bayern.de/Search/Hitlist/export',
      RII_BAYERN_POLICY,
    )).toThrow(/rejected path/i);
  });

  it('admits both official Bremen decision path families and rejects siblings', () => {
    for (const path of [
      '/entscheidungen/entscheidungsuebersicht-13039',
      '/gerichtsentscheidung-en/aufenthaltsrecht-2-k-1343-24-urteil-27121',
    ]) {
      expect(assertUrlAllowed(
        `https://www.verwaltungsgericht.bremen.de${path}`,
        RII_BREMEN_POLICY,
      ).pathname).toBe(path);
    }
    expect(() => assertUrlAllowed(
      'https://www.verwaltungsgericht.bremen.de/presse/secret',
      RII_BREMEN_POLICY,
    )).toThrow(/rejected path/i);
  });
});
