import { describe, expect, it } from 'vitest';
import { nautosEntitlementCacheScope } from './cache-scope.js';

describe('Nautos entitlement cache scope', () => {
  const base = { tenantKey: 'TENANT-A', tenantId: '42', username: 'User' };

  it('is stable and opaque', () => {
    const scope = nautosEntitlementCacheScope(base);
    expect(scope).toBe(nautosEntitlementCacheScope(base));
    expect(scope).not.toContain('TENANT');
    expect(scope).not.toContain('User');
  });

  it('partitions tenant, username and explicit entitlement identities', () => {
    expect(nautosEntitlementCacheScope(base)).not.toBe(nautosEntitlementCacheScope({
      ...base,
      tenantKey: 'TENANT-B',
    }));
    expect(nautosEntitlementCacheScope(base)).not.toBe(nautosEntitlementCacheScope({
      ...base,
      username: 'user',
    }));
    expect(nautosEntitlementCacheScope({ ...base, entitlementId: 'licence-a' })).not.toBe(
      nautosEntitlementCacheScope({ ...base, entitlementId: 'licence-b' }),
    );
  });
});
