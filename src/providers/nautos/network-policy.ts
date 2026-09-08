import type { NetworkPolicy } from '../../shared/network-policy.js';

/** Nautos is a credential-bearing integration with one immutable HTTPS origin. */
export const NAUTOS_ORIGIN = 'https://nautos.de';

/** Complete finite inventory of Nautos endpoints used by the client. */
export const NAUTOS_NETWORK_POLICY: NetworkPolicy = {
  name: 'Nautos API',
  rules: [{
    hostname: 'nautos.de',
    paths: [
      /^\/api\/authentication(?:\/[^/]{1,1024})?$/,
      /^\/api\/v1\/search$/,
      /^\/api\/v1\/detail\/[^/]{1,1024}$/,
      /^\/api\/v1\/documentaccess$/,
      /^\/api\/v1\/documentaccess\/simultaneously\/[^/]{1,1024}$/,
      /^\/api\/v1\/octa\/token$/,
      /^\/api\/nv\/nv-rest\/auth\/user$/,
      /^\/api\/nv\/nv-rest\/[^/]{1,1024}\/(?:toc|doc)$/,
    ],
  }],
};
