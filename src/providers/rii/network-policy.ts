import {
  assertOpaqueIdentifier,
  assertUrlAllowed,
  type NetworkPolicy,
} from '../../shared/network-policy.js';

export const RII_FEDERAL_POLICY: NetworkPolicy = {
  name: 'RII federal',
  rules: [{
    hostname: 'www.rechtsprechung-im-internet.de',
    paths: [
      /^\/jportal\/portal\/page\/bsjrsprod\.psml(?:\/js_peid\/Suchportlet2\/media-type\/html)?$/,
      /^\/rii-toc\.xml$/,
      /^\/jportal\/docs\/bsjrs\/[A-Za-z0-9._-]+\.zip$/,
    ],
  }],
};

export const RII_BAYERN_POLICY: NetworkPolicy = {
  name: 'RII Bayern',
  rules: [{
    hostname: 'www.gesetze-bayern.de',
    paths: [
      /^\/$/,
      /^\/Search$/,
      /^\/Search\/Hitlist$/,
      /^\/Search\/Page\/[1-9]\d*$/,
      /^\/Content\/Document\/[A-Za-z0-9._-]+$/,
    ],
  }],
};

export const RII_NRW_SEARCH_POLICY: NetworkPolicy = {
  name: 'RII NRW search',
  rules: [{ hostname: 'nrwesuche.justiz.nrw.de', paths: [/^\/index\.php$/] }],
};

export const RII_NRW_DOCUMENT_POLICY: NetworkPolicy = {
  name: 'RII NRW documents',
  rules: [{
    hostname: 'nrwe.justiz.nrw.de',
    paths: [/^\/(?:[A-Za-z0-9._(),%=-]+\/)*[A-Za-z0-9._(),%=-]+\.html$/],
  }],
};

export const RII_BREMEN_POLICY: NetworkPolicy = {
  name: 'RII Bremen',
  rules: [{
    hostname: 'www.verwaltungsgericht.bremen.de',
    paths: [
      /^\/entscheidungen\/[A-Za-z0-9._~()%-]{1,512}$/,
      /^\/gerichtsentscheidung-en\/[A-Za-z0-9._~()%-]{1,512}$/,
    ],
  }],
};

export const RII_BRANDENBURG_POLICY: NetworkPolicy = {
  name: 'RII Brandenburg',
  rules: [{
    hostname: 'gerichtsentscheidungen.brandenburg.de',
    paths: [/^\/suche$/, /^\/gerichtsentscheidung\/[A-Za-z0-9._-]+$/],
  }],
};

export const RII_NIEDERSACHSEN_POLICY: NetworkPolicy = {
  name: 'RII Niedersachsen',
  rules: [{
    hostname: 'voris.wolterskluwer-online.de',
    paths: [/^\/search$/, /^\/browse\/document\/[A-Za-z0-9._-]+$/],
  }],
};

export const RII_SACHSEN_POLICY: NetworkPolicy = {
  name: 'RII Sachsen',
  rules: [{
    hostname: 'www.justiz.sachsen.de',
    paths: [/^\/esamosplus\/pages\/suchen\.aspx$/],
  }],
};

export function assertRiiDocumentId(source: string, id: string): string {
  if (source === 'NW') return assertUrlAllowed(id, RII_NRW_DOCUMENT_POLICY).toString();
  if (source === 'HB') return assertUrlAllowed(id, RII_BREMEN_POLICY).toString();
  return assertOpaqueIdentifier(id, 'RII doc_id');
}
