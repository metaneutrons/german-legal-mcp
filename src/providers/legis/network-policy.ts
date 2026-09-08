import {
  assertOpaqueIdentifier,
  assertUrlAllowed,
  type NetworkPolicy,
} from '../../shared/network-policy.js';

export const LEGIS_GII_POLICY: NetworkPolicy = {
  name: 'Legis GII',
  rules: [{
    hostname: 'www.gesetze-im-internet.de',
    paths: [
      /^\/gii-toc\.xml$/,
      /^\/[A-Za-z0-9._+-]+\/(?:index|__[A-Za-z0-9ÄÖÜäöüß._%+-]+)\.html$/,
    ],
  }],
};

export const LEGIS_BAYERN_POLICY: NetworkPolicy = {
  name: 'Legis Bayern',
  rules: [{
    hostname: 'www.gesetze-bayern.de',
    paths: [
      /^\/Search$/,
      /^\/Search\/Hitlist$/,
      /^\/Content\/Document\/[A-Za-z0-9._-]+$/,
    ],
  }],
};

export const LEGIS_BRANDENBURG_POLICY: NetworkPolicy = {
  name: 'Legis Brandenburg',
  rules: [{
    hostname: 'bravors.brandenburg.de',
    paths: [
      /^\/de\/vorschriften_schnellsuche$/,
      /^\/de\/vorschriften_schnellsuche\/ergebnis$/,
      /^\/(?:gesetze|verordnungen|verwaltungsvorschriften)\/[A-Za-z0-9._~()%-]+(?:\/[A-Za-z0-9._~()%-]+)*$/,
    ],
  }],
};

export const LEGIS_BREMEN_POLICY: NetworkPolicy = {
  name: 'Legis Bremen',
  rules: [{
    hostname: 'www.transparenz.bremen.de',
    paths: [
      /^\/sixcms\/detail\.php$/,
      /^\/metainformationen\/[A-Za-z0-9ÄÖÜäöüß._~()%-]+$/,
    ],
  }],
};

export const LEGIS_NIEDERSACHSEN_POLICY: NetworkPolicy = {
  name: 'Legis Niedersachsen',
  rules: [{
    hostname: 'voris.wolterskluwer-online.de',
    paths: [/^\/search$/, /^\/browse\/document\/[A-Za-z0-9._-]+$/],
  }],
};

export const LEGIS_NRW_POLICY: NetworkPolicy = {
  name: 'Legis NRW',
  rules: [{
    hostname: 'recht.nrw.de',
    paths: [
      /^\/search-middleware\/opensearch_internet\/_search$/,
      /^\/(?:lrgv|gvnrw)\/[A-Za-z0-9._~()%-]+(?:\/[A-Za-z0-9._~()%-]+)*\/?$/,
    ],
  }],
};

export const LEGIS_SACHSEN_POLICY: NetworkPolicy = {
  name: 'Legis Sachsen',
  rules: [{
    hostname: 'www.revosax.sachsen.de',
    paths: [/^\/vorschriftensuche$/, /^\/suche$/, /^\/vorschrift\/[A-Za-z0-9._-]+$/],
  }],
};

function assertBundId(id: string): string {
  const slash = id.indexOf('/');
  const law = slash === -1 ? id : id.slice(0, slash);
  assertOpaqueIdentifier(law, 'BUND law id', /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/);
  if (slash !== -1) {
    const section = id.slice(slash + 1).trim();
    if (!section || section.length > 100 || !/^[A-Za-z0-9ÄÖÜäöüß§ ._-]+$/.test(section)) {
      throw new Error('BUND section id must be the opaque section returned by the provider.');
    }
  }
  return id;
}

function assertBrandenburgId(id: string): string {
  if (!/^(?:gesetze|verordnungen|verwaltungsvorschriften)\/[A-Za-z0-9._~()%-]+(?:\/[A-Za-z0-9._~()%-]+)*$/.test(id)) {
    throw new Error('Brandenburg law id must be the relative id returned by legis_search.');
  }
  return id;
}

export function assertLegisDocumentId(state: string, id: string): string {
  if (state === 'BUND') return assertBundId(id);
  if (state === 'BB') return assertBrandenburgId(id);
  if (state === 'HB' && /^https?:/i.test(id)) {
    return assertUrlAllowed(id, LEGIS_BREMEN_POLICY).toString();
  }
  return assertOpaqueIdentifier(id, `${state} legislation id`);
}
