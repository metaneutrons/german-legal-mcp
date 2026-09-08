import { assertUrlAllowed, type NetworkPolicy } from '../../shared/network-policy.js';

export const RIS_APPLIKATIONS = [
  'BrKons',
  'LrKons',
  'Justiz',
  'Vwgh',
  'Vfgh',
  'Bvwg',
  'Lvwg',
  'Bfg',
  'Dsk',
  'BgblAuth',
  'LgblAuth',
] as const;

const APPLIKATION_FOLDER: Record<(typeof RIS_APPLIKATIONS)[number], string> = {
  BrKons: 'Bundesnormen',
  LrKons: 'Landesnormen',
  Justiz: 'Justiz',
  Vwgh: 'Vwgh',
  Vfgh: 'Vfgh',
  Bvwg: 'Bvwg',
  Lvwg: 'Lvwg',
  Bfg: 'Bfg',
  Dsk: 'Dsk',
  BgblAuth: 'BgblAuth',
  LgblAuth: 'LgblAuth',
};

const RIS_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export const RIS_API_POLICY: NetworkPolicy = {
  name: 'RIS API',
  rules: [{
    hostname: 'data.bka.gv.at',
    paths: [/^\/ris\/api\/v2\.6\/(?:Bundesrecht|Landesrecht|Judikatur)$/],
  }],
};

export const RIS_DOCUMENT_POLICY: NetworkPolicy = {
  name: 'RIS documents',
  rules: [
    {
      hostname: 'www.ris.bka.gv.at',
      paths: [
        /^\/Dokumente\/(?:Bundesnormen|Landesnormen|Justiz|Vwgh|Vfgh|Bvwg|Lvwg|Bfg|Dsk|BgblAuth|LgblAuth)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.html$/,
        /^\/GeltendeFassung\.wxe$/,
      ],
    },
    // The OGD API currently returns this canonical host, which performs one
    // HTTPS redirect to the serving RIS origin below. Keep both hosts and the
    // single whole-law path explicit rather than broadening the document host.
    { hostname: 'ogd.ris.bka.gv.at', paths: [/^\/GeltendeFassung\.wxe$/] },
    { hostname: 'ris.bka.gv.at', paths: [/^\/GeltendeFassung\.wxe$/] },
  ],
  allowCrossOriginRedirects: true,
};

export function isRisApplikation(value: string): value is (typeof RIS_APPLIKATIONS)[number] {
  return (RIS_APPLIKATIONS as readonly string[]).includes(value);
}

export function assertRisDocumentUrl(url: string): string {
  return assertUrlAllowed(url, RIS_DOCUMENT_POLICY).toString();
}

export function buildRisDocumentUrl(applikation: string, id: string): string {
  if (!isRisApplikation(applikation)) {
    throw new Error(`Unsupported RIS applikation: ${applikation}`);
  }
  if (!RIS_ID.test(id)) {
    throw new Error('RIS document id must be the opaque id returned by ris_search.');
  }
  const folder = APPLIKATION_FOLDER[applikation];
  return `https://www.ris.bka.gv.at/Dokumente/${folder}/${id}/${id}.html`;
}
