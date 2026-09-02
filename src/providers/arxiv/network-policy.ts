import type { NetworkPolicy } from '../../shared/network-policy.js';

export const ARXIV_API_POLICY: NetworkPolicy = {
  name: 'arXiv API',
  rules: [{ hostname: 'export.arxiv.org', paths: [/^\/api\/query$/] }],
};

export const ARXIV_HTML_POLICY: NetworkPolicy = {
  name: 'arXiv HTML',
  rules: [{
    hostname: 'arxiv.org',
    paths: [
      /^\/html\/(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i,
    ],
  }],
};

export const ARXIV_ID_PATTERN = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;
