import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RisProvider } from './provider.js';
import type { RisClient } from './client.js';
import type { RisTocCache, CachedToc } from './toc-cache.js';

/** Real OGH Rechtssatz HTML captured from ris.bka.gv.at (no Randnummern). */
const REAL_DOC_HTML = readFileSync(
  fileURLToPath(new URL('./__fixtures__/judikatur-document.html', import.meta.url)),
  'utf8',
);
/** Real OGH Entscheidungstext HTML — carries [1]…[19] Randnummer markers. */
const DECISION_HTML = readFileSync(
  fileURLToPath(new URL('./__fixtures__/judikatur-decision.html', import.meta.url)),
  'utf8',
);
/** Real ABGB § 1295 document HTML. */
const NORM_HTML = readFileSync(
  fileURLToPath(new URL('./__fixtures__/norm-document.html', import.meta.url)),
  'utf8',
);

/** Minimal RIS Inhaltsverzeichnis HTML for the ris_toc handler test. */
const TOC_HTML =
  '<html><body>' +
  '<p class="InhaltEintrag">§ 1.</p><p class="InhaltEintrag">Begriff.</p>' +
  '<p class="InhaltEintrag">§ 2.</p><p class="InhaltEintrag">Zweiter.</p>' +
  '</body></html>';

function clientStub(over: Partial<RisClient> = {}): RisClient {
  return {
    search: vi.fn(),
    getNorm: vi.fn(),
    resolveWholeLawUrl: vi.fn(),
    fetchHtml: vi.fn(),
    ...over,
  } as unknown as RisClient;
}

/** In-memory TOC cache so provider tests never touch the real state dir. */
function memCache(seed?: CachedToc): RisTocCache {
  const store = new Map<string, CachedToc>();
  if (seed) store.set(seed.url, seed);
  return {
    get: vi.fn(async (url: string) => store.get(url) ?? null),
    put: vi.fn(async (entry: CachedToc) => {
      store.set(entry.url, entry);
    }),
  };
}

const text = (r: { content: Array<{ text: string }> }): string => r.content.map((c) => c.text).join('\n');

describe('RisProvider', () => {
  it('exposes ris_search, ris_get, ris_get_norm and ris_toc', () => {
    const provider = new RisProvider(clientStub());
    expect(provider.getTools().map((t) => t.name)).toEqual([
      'ris_search',
      'ris_get',
      'ris_get_norm',
      'ris_toc',
    ]);
  });

  it('ris_toc resolves the whole-law URL and returns a parsed § list', async () => {
    const resolveWholeLawUrl = vi.fn().mockResolvedValue({
      title: 'ABGB',
      url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622',
    });
    const fetchHtml = vi.fn().mockResolvedValue(TOC_HTML);
    const provider = new RisProvider(clientStub({ resolveWholeLawUrl, fetchHtml }), memCache());

    const res = await provider.handleToolCall('ris_toc', { law: 'ABGB' });
    expect(resolveWholeLawUrl).toHaveBeenCalledWith('bundesrecht', expect.objectContaining({ law: 'ABGB' }));
    const t = text(res);
    expect(t).toContain('Inhaltsverzeichnis (2 §§)');
    expect(t).toContain('§ 1 — Begriff');
    expect(t).toContain('§ 2 — Zweiter');
    expect(t).toContain('ris_get_norm');
  });

  it('ris_toc serves a warm cache without re-fetching the whole-law HTML', async () => {
    const wholeLawUrl = 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622';
    const resolveWholeLawUrl = vi.fn().mockResolvedValue({ title: 'ABGB', url: wholeLawUrl });
    const fetchHtml = vi.fn().mockResolvedValue(TOC_HTML);
    const cache = memCache({
      url: wholeLawUrl,
      title: 'ABGB',
      entries: [{ paragraph: '1295', heading: 'Schadenersatz' }],
      fetchedAt: Date.now(),
    });
    const provider = new RisProvider(clientStub({ resolveWholeLawUrl, fetchHtml }), cache);

    const res = await provider.handleToolCall('ris_toc', { law: 'ABGB' });
    expect(fetchHtml).not.toHaveBeenCalled();
    expect(text(res)).toContain('§ 1295 — Schadenersatz');
  });

  it('ris_toc caches the parsed result — a second call does not re-fetch', async () => {
    const resolveWholeLawUrl = vi.fn().mockResolvedValue({
      title: 'ABGB',
      url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622',
    });
    const fetchHtml = vi.fn().mockResolvedValue(TOC_HTML);
    const provider = new RisProvider(clientStub({ resolveWholeLawUrl, fetchHtml }), memCache());

    await provider.handleToolCall('ris_toc', { law: 'ABGB' });
    await provider.handleToolCall('ris_toc', { law: 'ABGB' });
    expect(fetchHtml).toHaveBeenCalledTimes(1);
  });

  it('ris_toc errors with a hint when the law cannot be resolved', async () => {
    const resolveWholeLawUrl = vi.fn().mockResolvedValue(null);
    const provider = new RisProvider(clientStub({ resolveWholeLawUrl }), memCache());

    const res = await provider.handleToolCall('ris_toc', { law: 'UrhG' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('full title');
  });

  it('ris_get_norm fetches a specific § and returns its text', async () => {
    const getNorm = vi.fn().mockResolvedValue({
      total: 1,
      page: 1,
      hits: [{
        id: 'NOR12019037',
        applikation: 'BrKons',
        title: 'ABGB',
        contentUrl: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
      }],
    });
    const fetchHtml = vi.fn().mockResolvedValue(NORM_HTML);
    const provider = new RisProvider(clientStub({ getNorm, fetchHtml }));

    const res = await provider.handleToolCall('ris_get_norm', { law: 'ABGB', paragraph: '1295' });
    expect(getNorm).toHaveBeenCalledWith('bundesrecht', expect.objectContaining({ law: 'ABGB', paragraph: '1295' }));
    expect(text(res)).toContain('1295');
    expect(text(res)).toContain('Jedermann');
  });

  it('ris_get_norm errors when the § is not found', async () => {
    const getNorm = vi.fn().mockResolvedValue({ total: 0, page: 1, hits: [] });
    const provider = new RisProvider(clientStub({ getNorm }));

    const res = await provider.handleToolCall('ris_get_norm', { law: 'ABGB', paragraph: '99999' });
    expect(res.isError).toBe(true);
  });

  it('formats search results with title, id, applikation, court and url', async () => {
    const search = vi.fn().mockResolvedValue({
      total: 82,
      page: 1,
      hits: [
        {
          id: 'JJT_1',
          applikation: 'Justiz',
          title: '4Ob1/24a',
          organ: 'OGH',
          date: '2024-01-01',
          ecli: 'ECLI:AT:OGH',
          contentUrl: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_1/JJT_1.html',
        },
      ],
    });
    const provider = new RisProvider(clientStub({ search }));

    const res = await provider.handleToolCall('ris_search', { query: 'x', application: 'judikatur', court: 'Justiz' });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('Found 82 results');
    expect(text(res)).toContain('`JJT_1`');
    expect(text(res)).toContain('OGH');
    expect(text(res)).toContain('JJT_1.html');
  });

  it('passes sort through and surfaces the newest linked full decision', async () => {
    const search = vi.fn().mockResolvedValue({
      total: 5,
      page: 1,
      hits: [
        {
          id: 'JJR_1',
          applikation: 'Justiz',
          title: 'Rechtssatz RS1',
          organ: 'OGH',
          date: '2026-06-23',
          contentUrl: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJR_1/JJR_1.html',
          decisionTexts: [{ id: 'JJT_LATEST', date: '2026-06-23', geschaeftszahl: '3 Ob 73/26w' }],
        },
      ],
    });
    const provider = new RisProvider(clientStub({ search }));

    const res = await provider.handleToolCall('ris_search', {
      query: 'x',
      application: 'judikatur',
      court: 'Justiz',
      sort: 'date',
    });
    expect(search).toHaveBeenCalledWith('judikatur', expect.objectContaining({ sort: 'date' }));
    expect(text(res)).toContain('full decision');
    expect(text(res)).toContain('JJT_LATEST');
    expect(text(res)).toContain('applikation=Justiz');
  });

  it('uses the hit’s applikation in the full-decision hint (not hardcoded Justiz)', async () => {
    const search = vi.fn().mockResolvedValue({
      total: 1,
      page: 1,
      hits: [
        {
          id: 'JWR_1',
          applikation: 'Vwgh',
          title: 'Ra 2024/02/0082',
          organ: 'VwGH',
          date: '2026-04-23',
          decisionTexts: [{ id: 'JWT_1', date: '2026-04-23' }],
        },
      ],
    });
    const provider = new RisProvider(clientStub({ search }));

    const res = await provider.handleToolCall('ris_search', { query: 'x', application: 'judikatur', court: 'Vwgh' });
    expect(text(res)).toContain('JWT_1');
    expect(text(res)).toContain('applikation=Vwgh');
  });

  it('searches landesrecht and shows each result’s Bundesland', async () => {
    const search = vi.fn().mockResolvedValue({
      total: 304,
      page: 1,
      hits: [
        {
          id: 'LGBLA_TI_1',
          applikation: 'LgblAuth',
          title: 'Tiroler Bauordnung 2022',
          organ: 'LReg Tirol',
          bundesland: 'Tirol',
          contentUrl: 'https://www.ris.bka.gv.at/Dokumente/LgblAuth/LGBLA_TI_1/LGBLA_TI_1.html',
        },
      ],
    });
    const provider = new RisProvider(clientStub({ search }));

    const res = await provider.handleToolCall('ris_search', { query: 'Bauordnung', application: 'landesrecht' });
    expect(search).toHaveBeenCalledWith('landesrecht', expect.objectContaining({ query: 'Bauordnung' }));
    expect(text(res)).toContain('Tiroler Bauordnung');
    expect(text(res)).toContain('Tirol');
  });

  it('passes bundesland through for landesrecht', async () => {
    const search = vi.fn().mockResolvedValue({
      total: 983,
      page: 1,
      hits: [{ id: 'x', applikation: 'LrKons', title: 'Bauordnung für Wien', bundesland: 'Wien' }],
    });
    const provider = new RisProvider(clientStub({ search }));

    await provider.handleToolCall('ris_search', {
      query: 'Bauordnung',
      application: 'landesrecht',
      bundesland: 'Wien',
    });
    expect(search).toHaveBeenCalledWith('landesrecht', expect.objectContaining({ bundesland: 'Wien' }));
  });

  it('reports an empty result set cleanly', async () => {
    const search = vi.fn().mockResolvedValue({ total: 0, page: 1, hits: [] });
    const provider = new RisProvider(clientStub({ search }));
    const res = await provider.handleToolCall('ris_search', { query: 'zzz' });
    expect(text(res)).toContain('No RIS results');
  });

  it('fetches and converts a real RIS document by content_url', async () => {
    const fetchHtml = vi.fn().mockResolvedValue(REAL_DOC_HTML);
    const provider = new RisProvider(clientStub({ fetchHtml }));

    const url = 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_1/JJT_1.html';
    const res = await provider.handleToolCall('ris_get', { content_url: url });
    expect(fetchHtml).toHaveBeenCalledWith(url);
    expect(text(res)).toContain('OGH');
    expect(text(res)).toContain('Werknutzung');
  });

  it('derives the content URL from id + applikation', async () => {
    const fetchHtml = vi.fn().mockResolvedValue(REAL_DOC_HTML);
    const provider = new RisProvider(clientStub({ fetchHtml }));

    await provider.handleToolCall('ris_get', { id: 'JJT_1', applikation: 'Justiz' });
    expect(fetchHtml).toHaveBeenCalledWith('https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_1/JJT_1.html');
  });

  it('maps a BrKons id to the Bundesnormen document folder (not the literal applikation)', async () => {
    const fetchHtml = vi.fn().mockResolvedValue(REAL_DOC_HTML);
    const provider = new RisProvider(clientStub({ fetchHtml }));

    await provider.handleToolCall('ris_get', { id: 'NOR12018914', applikation: 'BrKons' });
    expect(fetchHtml).toHaveBeenCalledWith(
      'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12018914/NOR12018914.html',
    );
  });

  it('returns only the requested Randnummer via section (token-preserving)', async () => {
    const fetchHtml = vi.fn().mockResolvedValue(DECISION_HTML);
    const provider = new RisProvider(clientStub({ fetchHtml }));

    const res = await provider.handleToolCall('ris_get', {
      content_url: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_1/JJT_1.html',
      section: 'Rn 5',
    });
    const t = text(res);
    expect(t).toContain('[Rn. 5]{.rn}');
    expect(t).not.toContain('[Rn. 4]{.rn}');
    expect(t).not.toContain('[Rn. 6]{.rn}');
    // A single Randnummer is a tiny slice of the full (~4k-token) decision.
    expect(t.length).toBeLessThan(1000);
  });

  it('returns a heading section (Spruch) via section', async () => {
    const fetchHtml = vi.fn().mockResolvedValue(DECISION_HTML);
    const provider = new RisProvider(clientStub({ fetchHtml }));

    const res = await provider.handleToolCall('ris_get', {
      content_url: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_1/JJT_1.html',
      section: 'Spruch',
    });
    expect(text(res)).toContain('# Spruch');
    expect(text(res)).toContain('Revision wird zurückgewiesen');
  });

  it('section and save_path compose — saves the extracted section, not the whole document', async () => {
    const fetchHtml = vi.fn().mockResolvedValue(DECISION_HTML);
    const provider = new RisProvider(clientStub({ fetchHtml }));
    const exportRoot = join(process.env.GLMCP_STATE_DIR!, 'exports');
    await mkdir(exportRoot, { recursive: true });
    const dir = await mkdtemp(join(exportRoot, 'ris-get-'));
    const path = join(dir, 'rn5.md');
    try {
      const res = await provider.handleToolCall('ris_get', {
        content_url: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_1/JJT_1.html',
        section: 'Rn 5',
        save_path: path,
      });
      // Returns a save confirmation, not the inline content.
      expect(text(res)).toContain(path);
      const saved = await readFile(path, 'utf8');
      expect(saved).toContain('[Rn. 5]{.rn}');
      expect(saved).not.toContain('[Rn. 6]{.rn}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('errors when ris_get has neither content_url nor id+applikation', async () => {
    const provider = new RisProvider(clientStub());
    const res = await provider.handleToolCall('ris_get', {});
    expect(res.isError).toBe(true);
  });

  it.each([
    'http://www.ris.bka.gv.at/Dokumente/Justiz/JJT_1/JJT_1.html',
    'https://127.0.0.1/private',
    'https://169.254.169.254/latest/meta-data/',
    'https://user:password@www.ris.bka.gv.at/Dokumente/Justiz/JJT_1/JJT_1.html',
    'https://www.ris.bka.gv.at/Dokumente/Justiz/%2e%2e/private.html',
  ])('rejects unsafe ris_get content_url %s before fetching', async (content_url) => {
    const fetchHtml = vi.fn();
    const provider = new RisProvider(clientStub({ fetchHtml }));
    await expect(provider.handleToolCall('ris_get', { content_url })).rejects.toThrow(/network policy/);
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('errors on an unknown tool', async () => {
    const provider = new RisProvider(clientStub());
    const res = await provider.handleToolCall('ris_bogus', {});
    expect(res.isError).toBe(true);
  });
});
