import { readBooleanEnv } from '../../config.js';

export const arxivConfig = {
  apiUrl: 'https://export.arxiv.org/api/query',
  htmlUrl: 'https://arxiv.org/html',
  enabled: readBooleanEnv('GLMCP_ARXIV_ENABLED', true),
};
