import type { AxiosInstance } from 'axios';
import { isAwsWafChallenge } from './aws-waf.js';
import { safeAxiosGet, type NetworkPolicy } from './network-policy.js';

/**
 * Document texts from the EU Publications Office's Cellar.
 *
 * eur-lex.europa.eu is a website behind an AWS WAF that answers clients
 * without a browser with a JavaScript challenge. Cellar is the machine
 * interface to the same documents: `/resource/celex/{CELEX}` negotiates on
 * Accept and Accept-Language and answers 303 to exactly one manifestation
 * file, `/resource/cellar/{work-uuid}.{expression}.{manifestation}/DOC_{n}`,
 * or 404 when the document does not exist in that language.
 */

/** ISO 639-1 → the ISO 639-2/T codes Cellar uses, for all official EU languages. */
export const CELLAR_LANGUAGES: Readonly<Record<string, string>> = {
  BG: 'BUL', CS: 'CES', DA: 'DAN', DE: 'DEU', EL: 'ELL', EN: 'ENG', ES: 'SPA', ET: 'EST',
  FI: 'FIN', FR: 'FRA', GA: 'GLE', HR: 'HRV', HU: 'HUN', IT: 'ITA', LT: 'LIT', LV: 'LAV',
  MT: 'MLT', NL: 'NLD', PL: 'POL', PT: 'POR', RO: 'RON', SK: 'SLK', SL: 'SLV', SV: 'SWE',
};

export const CELLAR_DOCUMENT_POLICY: NetworkPolicy = {
  name: 'Cellar documents',
  rules: [{
    hostname: 'publications.europa.eu',
    paths: [
      /^\/resource\/celex\/[0-9][A-Z0-9()_-]{4,31}$/i,
      /^\/resource\/cellar\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]{4}\.[0-9]{2}\/DOC_[0-9]{1,4}$/,
    ],
  }],
};

const CELLAR_CELEX = 'https://publications.europa.eu/resource/celex';

/**
 * Cellar redirects to its manifestation files with an `http:` Location. The
 * same resource is served over HTTPS, so exactly that host and path family is
 * upgraded; every other target keeps its scheme and is judged by the policy.
 */
export function upgradeCellarRedirect(location: URL): string {
  if (
    location.protocol === 'http:'
    && location.hostname === 'publications.europa.eu'
    && !location.port
    && location.pathname.startsWith('/resource/cellar/')
  ) {
    const upgraded = new URL(location.toString());
    upgraded.protocol = 'https:';
    return upgraded.toString();
  }
  return location.toString();
}

export type CellarText =
  | { readonly kind: 'document'; readonly url: string; readonly html: string }
  /** No XHTML/HTML manifestation in this language (404/406). */
  | { readonly kind: 'missing'; readonly url: string }
  /** A bot challenge instead of the document; never content. */
  | { readonly kind: 'challenge'; readonly url: string };

/**
 * Fetch one document's XHTML (or, for acts from before 2014, HTML) text.
 * `language` is the two-letter code; an unsupported code is an error.
 */
export async function fetchCellarText(
  http: Pick<AxiosInstance, 'get'>,
  celex: string,
  language: string,
  options: { readonly timeout?: number } = {},
): Promise<CellarText> {
  const lang3 = CELLAR_LANGUAGES[language.toUpperCase()];
  if (!lang3) throw new Error(`Unsupported Cellar language: ${language}`);
  const url = `${CELLAR_CELEX}/${celex.toUpperCase()}`;
  const response = await safeAxiosGet<string>(
    http,
    url,
    CELLAR_DOCUMENT_POLICY,
    {
      headers: {
        // The Official Journal has XHTML since 2014; older acts exist only as HTML.
        'Accept': 'application/xhtml+xml, text/html;q=0.9',
        'Accept-Language': lang3.toLowerCase(),
      },
      timeout: options.timeout ?? 60_000,
      maxContentLength: 25 * 1024 * 1024,
      responseType: 'text',
      // Judge every answer below 500 here, so that a challenge or a missing
      // manifestation is reported as what it is rather than as a document.
      validateStatus: (status) => status < 500,
    },
    { rewriteRedirect: upgradeCellarRedirect },
  );
  if (isAwsWafChallenge(response)) return { kind: 'challenge', url };
  if (response.status === 404 || response.status === 406) return { kind: 'missing', url };
  if (response.status !== undefined && response.status !== 200) {
    throw new Error(`Cellar answered HTTP ${response.status} for CELEX ${celex}.`);
  }
  if (typeof response.data !== 'string') {
    throw new Error(`Cellar returned no text for CELEX ${celex}.`);
  }
  return { kind: 'document', url, html: response.data };
}
