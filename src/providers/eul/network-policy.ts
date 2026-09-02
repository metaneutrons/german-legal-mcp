import type { NetworkPolicy } from '../../shared/network-policy.js';

export const EUL_SPARQL_POLICY: NetworkPolicy = {
  name: 'EUR-Lex SPARQL',
  rules: [{
    hostname: 'publications.europa.eu',
    paths: [/^\/webapi\/rdf\/sparql$/],
  }],
};

export const EUL_DOCUMENT_POLICY: NetworkPolicy = {
  name: 'EUR-Lex documents',
  rules: [{
    hostname: 'eur-lex.europa.eu',
    paths: [/^\/legal-content\/[A-Z]{2}\/TXT\/HTML\/$/],
  }],
};

export const CELEX_PATTERN = /^[0-9][A-Z0-9()_-]{4,31}$/i;
