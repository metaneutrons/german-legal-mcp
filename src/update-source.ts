import axios from 'axios';
import { safeAxiosGet, type NetworkPolicy } from './shared/network-policy.js';
import type { ReleaseSource } from './update-check.js';

const DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@metaneutrons/german-legal-mcp/dist-tags';
const POLICY: NetworkPolicy = {
  name: 'npm registry release check',
  rules: [{
    hostname: 'registry.npmjs.org',
    paths: ['/-/package/@metaneutrons/german-legal-mcp/dist-tags'],
  }],
};
const HOW_TO_UPDATE = 'update the German Legal MCP extension in Claude Desktop, or restart '
  + 'with npx -y @metaneutrons/german-legal-mcp@latest.';

/** The public build asks the public npm registry for its `latest` dist-tag. */
export function releaseSource(): ReleaseSource | undefined {
  return {
    howToUpdate: HOW_TO_UPDATE,
    fetchLatest: async (timeoutMs) => {
      const response = await safeAxiosGet<unknown>(axios, DIST_TAGS_URL, POLICY, {
        timeout: timeoutMs,
        maxContentLength: 64 * 1024,
        responseType: 'json',
      });
      const latest = (response.data as { latest?: unknown } | null)?.latest;
      return typeof latest === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(latest)
        ? { version: latest, url: `https://www.npmjs.com/package/@metaneutrons/german-legal-mcp/v/${latest}` }
        : undefined;
    },
  };
}
