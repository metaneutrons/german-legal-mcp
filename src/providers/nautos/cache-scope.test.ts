import { describe, expect, it } from 'vitest';
import { nautosEntitlementCacheScope } from './cache-scope.js';

describe('Nautos entitlement cache scope', () => {
  const base = { tenantKey: 'TENANT-A', tenantId: '42', username: 'User' };

  it('is stable and opaque', () => {
    const scope = nautosEntitlementCacheScope(base);
    expect(scope).toBe(nautosEntitlementCacheScope(base));
    expect(scope).toBe('e1-a341cb8cb676ea9ed30b5643');
    expect(scope).not.toContain('TENANT');
    expect(scope).not.toContain('User');
  });

  it('partitions tenant and username identities', () => {
    expect(nautosEntitlementCacheScope(base)).not.toBe(nautosEntitlementCacheScope({
      ...base,
      tenantKey: 'TENANT-B',
    }));
    expect(nautosEntitlementCacheScope(base)).not.toBe(nautosEntitlementCacheScope({
      ...base,
      username: 'user',
    }));
  });
});
