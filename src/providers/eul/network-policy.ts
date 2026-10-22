import type { NetworkPolicy } from '../../shared/network-policy.js';
import { CELLAR_DOCUMENT_POLICY } from '../../shared/cellar.js';

export const EUL_SPARQL_POLICY: NetworkPolicy = {
  name: 'EUR-Lex SPARQL',
  rules: [{
    hostname: 'publications.europa.eu',
    paths: [/^\/webapi\/rdf\/sparql$/],
  }],
};

/** Full texts come from Cellar; see shared/cellar.ts for why not eur-lex.europa.eu. */
export const EUL_DOCUMENT_POLICY: NetworkPolicy = CELLAR_DOCUMENT_POLICY;

export const CELEX_PATTERN = /^[0-9][A-Z0-9()_-]{4,31}$/i;
