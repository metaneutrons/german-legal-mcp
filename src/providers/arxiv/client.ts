import axios from 'axios';
import { load } from 'cheerio';
import { HTTP_USER_AGENT } from '../../config.js';
import { safeAxiosGet } from '../../shared/network-policy.js';
import { arxivConfig } from './config.js';
import { ARXIV_API_POLICY, ARXIV_HTML_POLICY } from './network-policy.js';

export interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  updated: string;
  categories: string[];
  primaryCategory: string;
  doi?: string;
  journalRef?: string;
  comment?: string;
  pdfUrl: string;
  htmlUrl: string;
}

export class ArxivClient {
  async search(params: Record<string, string | number>): Promise<{ total: number; entries: ArxivEntry[] }> {
    // arXiv's API terms ask callers to identify themselves; every other client
    // in this project already does, and a generic library UA invites throttling.
    const { data } = await safeAxiosGet<string>(axios, arxivConfig.apiUrl, ARXIV_API_POLICY, {
      params,
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024,
      headers: { 'User-Agent': HTTP_USER_AGENT },
    });
    return this.parseAtom(data);
  }

  async getHtml(arxivId: string): Promise<string | null> {
    try {
      const { data } = await safeAxiosGet<string>(
        axios,
        `${arxivConfig.htmlUrl}/${arxivId}`,
        ARXIV_HTML_POLICY,
        {
        timeout: 30000,
        maxContentLength: 25 * 1024 * 1024,
        headers: { 'User-Agent': HTTP_USER_AGENT },
        },
      );
      return data;
    } catch {
      return null;
    }
  }

  private parseAtom(xml: string): { total: number; entries: ArxivEntry[] } {
    const $ = load(xml, { xml: true });
    const total = Number($('opensearch\\:totalResults').text()) || 0;
    const entries: ArxivEntry[] = [];

    $('entry').each((_, el) => {
      const $e = $(el);
      const rawId = $e.find('id').text().replace('http://arxiv.org/abs/', '');
      const doi = $e.find('arxiv\\:doi').text() || undefined;
      const journalRef = $e.find('arxiv\\:journal_ref').text() || undefined;
      const comment = $e.find('arxiv\\:comment').text() || undefined;
      entries.push({
        id: rawId,
        title: $e.find('title').text().replace(/\s+/g, ' ').trim(),
        summary: $e.find('summary').text().trim(),
        authors: $e.find('author name').map((__, n) => $(n).text()).get(),
        published: $e.find('published').text().slice(0, 10),
        updated: $e.find('updated').text().slice(0, 10),
        categories: $e.find('category').map((__, c) => $(c).attr('term') || '').get(),
        primaryCategory: $e.find('arxiv\\:primary_category').attr('term') || '',
        ...(doi === undefined ? {} : { doi }),
        ...(journalRef === undefined ? {} : { journalRef }),
        ...(comment === undefined ? {} : { comment }),
        pdfUrl: `https://arxiv.org/pdf/${rawId}`,
        htmlUrl: `https://arxiv.org/html/${rawId}`,
      });
    });

    return { total, entries };
  }
}
