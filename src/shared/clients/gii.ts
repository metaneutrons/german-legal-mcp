import { HTTP_USER_AGENT } from '../../config.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { rootLogger } from '../logger.js';
import { safeAxiosGet, type NetworkPolicy } from '../network-policy.js';

const logger = rootLogger.child({ module: 'gii-client' });

const BASE_URL = 'https://www.gesetze-im-internet.de';
const GII_POLICY: NetworkPolicy = {
  name: 'GII documents',
  rules: [{
    hostname: 'www.gesetze-im-internet.de',
    paths: [/^\/[A-Za-z0-9._+-]+\/(?:__|art_)[A-Za-z0-9ÄÖÜäöüß._%+-]+\.html$/],
  }],
};

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

export interface GiiResult {
  title: string;
  section: string;
  content: string;
  url: string;
  prev: string | null;
  next: string | null;
}

/**
 * gesetze-im-internet.de usually hosts a law under its lowercase abbreviation,
 * but some laws that were later reissued/renumbered keep the original
 * promulgation year in their slug instead (e.g. BtMG -> "btmg_1981"). There is
 * no generic way to derive this from the abbreviation, so known mismatches
 * are aliased here as they're discovered.
 */
const LAW_SLUG_ALIASES: Record<string, string> = {
  btmg: 'btmg_1981',
};

export async function giiGetLegislation(law: string, section: string): Promise<GiiResult> {
  const lawLower = law.toLowerCase();
  const lawNorm = LAW_SLUG_ALIASES[lawLower] ?? lawLower;

  // gesetze-im-internet.de names a section page "__<n>.html" for laws numbered
  // by paragraph and "art_<n>.html" for laws numbered by article (GG, EGBGB).
  // An "Art."/"Artikel" prefix in the request selects the article form.
  let sectionNorm = section.trim();
  const isArticle = /^Art(?:ikel|\.)?(?=\s|\d|$)/i.test(sectionNorm);
  if (!/^(?:__|art_)/i.test(sectionNorm)) {
    sectionNorm = sectionNorm.replace(/^(§|Paragraph|Para\.?|Artikel|Art\.?)\s*/i, '');
  }
  if (isArticle && !sectionNorm.startsWith('art_')) {
    sectionNorm = 'art_' + sectionNorm;
  } else if (!isArticle && !sectionNorm.startsWith('__') && !sectionNorm.startsWith('art_')) {
    sectionNorm = '__' + sectionNorm;
  }

  const url = `${BASE_URL}/${lawNorm}/${sectionNorm}.html`;
  logger.info('Fetching legislation', { law, section, url });

  try {
    const response = await safeAxiosGet<ArrayBuffer>(axios, url, GII_POLICY, {
      headers: { 'User-Agent': HTTP_USER_AGENT },
      responseType: 'arraybuffer',
    });

    const html = Buffer.from(response.data).toString('latin1');
    const $ = cheerio.load(html);

    const lawTitle = $('.jnheader h1')
      .contents()
      .filter(function () { return String(this.type) === 'text'; })
      .text()
      .trim();
    const sectionLabel = $('.jnenbez').text().trim();
    const sectionTitle = $('.jnentitel').text().trim();
    const contentHtml = $('.jnhtml').html() || '';
    const content = turndown.turndown(contentHtml);
    const prevHref = $('a[href*="__"][title*="vorherigen"], a[href*="art_"][title*="vorherigen"]').first().attr('href');
    const nextHref = $('a[href*="__"][title*="nachfolgenden"], a[href*="art_"][title*="nachfolgenden"]').first().attr('href');

    return {
      title: `${lawTitle}\n${sectionLabel} ${sectionTitle}`,
      section: sectionLabel,
      content,
      url,
      prev: prevHref || null,
      next: nextHref || null,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      throw new Error(
        `Legislation not found: ${law} ${section} (tried ${url}). ` +
        'Either this abbreviation does not match gesetze-im-internet.de\'s URL slug — some reissued laws ' +
        'use a different slug than their common abbreviation, which cannot be resolved from the ' +
        'abbreviation alone — or this section number does not exist in the law. ' +
        'A subscription provider that resolves abbreviations through its own index may still find it.',
        { cause: error },
      );
    }
    throw error;
  }
}
