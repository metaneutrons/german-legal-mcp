import { createHash } from 'node:crypto';

const NAUTOS_SCOPE_VERSION = 1;

export interface NautosEntitlementIdentity {
  tenantKey?: string;
  tenantId?: string;
  username?: string;
  entitlementId?: string;
}

/** Opaque partition for licensed Nautos full text; passwords are excluded. */
export function nautosEntitlementCacheScope(identity: NautosEntitlementIdentity): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      version: NAUTOS_SCOPE_VERSION,
      tenantKey: normalize(identity.tenantKey),
      tenantId: normalize(identity.tenantId),
      username: normalize(identity.username),
      entitlementId: normalize(identity.entitlementId ?? ''),
    }))
    .digest('hex')
    .slice(0, 24);
  return `e${NAUTOS_SCOPE_VERSION}-${digest}`;
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().normalize('NFC');
}
