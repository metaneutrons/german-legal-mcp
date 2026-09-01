import type { NetworkPolicy } from '../../shared/network-policy.js';

/** Exact egress boundary for the five DIP operations exposed by this provider. */
export const DIP_API_POLICY: NetworkPolicy = {
  name: 'DIP API',
  rules: [{
    hostname: 'search.dip.bundestag.de',
    paths: [
      /^\/api\/v1\/drucksache$/,
      /^\/api\/v1\/drucksache\/[^/]+$/,
      /^\/api\/v1\/drucksache-text$/,
      /^\/api\/v1\/vorgang$/,
      /^\/api\/v1\/plenarprotokoll-text$/,
    ],
  }],
};
