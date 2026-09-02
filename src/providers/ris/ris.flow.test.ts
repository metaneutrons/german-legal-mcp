import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RisClient } from './client.js';
import { RisProvider } from './provider.js';
import type { OgdResponse } from './types.js';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');
}
const searchResponse = JSON.parse(fixture('judikatur-search.json')) as OgdResponse;
const documentHtml = fixture('judikatur-document.html');

/**
 * Fixture-backed, deterministic integration of the whole RIS pipeline
 * (search → surface linked decision → get → convert). Runs OFFLINE in CI, using
 * the real responses captured under __fixtures__. Normalized live verification
 * lives in tests/live/public-providers.live.ts.
 */
describe('RIS provider flow (fixture-backed, offline)', () => {
  function providerWithFixtures(): RisProvider {
    // Route the search endpoint to the JSON fixture and any document URL to the
    // captured HTML — no network.
    const get = vi.fn((url: string) =>
      url.endsWith('.html')
        ? Promise.resolve({ data: documentHtml })
        : Promise.resolve({ data: searchResponse }),
    );
    return new RisProvider(new RisClient({ get }));
  }

  const textOf = (r: { content: Array<{ text: string }> }): string => r.content.map((c) => c.text).join('\n');

  it('searches Judikatur, surfaces the linked full decision, then gets + converts it', async () => {
    const provider = providerWithFixtures();

    const search = await provider.handleToolCall('ris_search', {
      query: 'Werknutzung',
      application: 'judikatur',
      court: 'Justiz',
      sort: 'date',
      limit: 5,
    });
    const searchText = textOf(search);
    expect(searchText).toContain('Rechtssatz RS0106668');
    expect(searchText).toContain('full decision');
    expect(searchText).toContain('JJT_20201210_OGH0002_0040OB00182_20Y0000_000');

    const get = await provider.handleToolCall('ris_get', {
      id: 'JJT_20201210_OGH0002_0040OB00182_20Y0000_000',
      applikation: 'Justiz',
    });
    const getText = textOf(get);
    expect(getText).toContain('OGH');
    expect(getText).toContain('Rechtssatz');
    expect(getText.length).toBeGreaterThan(200);
  });
});
