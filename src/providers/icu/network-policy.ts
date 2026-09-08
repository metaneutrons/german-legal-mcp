import type { NetworkPolicy } from '../../shared/network-policy.js';

export const ICU_SEARCH_POLICY: NetworkPolicy = {
  name: 'InfoCuria search',
  rules: [{
    hostname: 'infocuriaws.curia.europa.eu',
    paths: [/^\/elastic-connector\/search$/],
  }],
};

export const ICU_DOCUMENT_POLICY: NetworkPolicy = {
  name: 'InfoCuria documents',
  rules: [{
    hostname: 'infocuriaws.curia.europa.eu',
    paths: [/^\/blob\/download-file\/\d+\/[A-Z]{2}\/html$/],
  }],
};

export const ICU_SPARQL_POLICY: NetworkPolicy = {
  name: 'Cellar SPARQL',
  rules: [{
    hostname: 'publications.europa.eu',
    paths: [/^\/webapi\/rdf\/sparql$/],
  }],
};

export const ICU_EURLEX_POLICY: NetworkPolicy = {
  name: 'EUR-Lex case law',
  rules: [{
    hostname: 'eur-lex.europa.eu',
    paths: [/^\/legal-content\/[A-Z]{2}\/TXT\/HTML\/$/],
  }],
};
