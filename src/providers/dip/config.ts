import { readBooleanEnv, readStringEnv } from '../../config.js';

// Public API key — valid until end of May 2027 (dip.bundestag.de/über-dip/hilfe/api)
const DEFAULT_API_KEY = Date.now() < new Date('2027-06-01').getTime() ? 'R2BZaee.DjdCyihKZMf8AOjtScubP2EVydegzjmBIQ' : '';
const apiKey = readStringEnv('GLMCP_DIP_API_KEY') ?? DEFAULT_API_KEY;

export const dipConfig = {
  apiKey,
  baseUrl: 'https://search.dip.bundestag.de/api/v1',
  enabled: readBooleanEnv('GLMCP_DIP_ENABLED', true) && !!apiKey,
};
