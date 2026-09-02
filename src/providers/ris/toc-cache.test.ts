import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskTocCache, type CachedToc } from './toc-cache.js';

const sample = (url: string): CachedToc => ({
  url,
  title: 'ABGB',
  entries: [{ paragraph: '1295', heading: 'Schadenersatz' }],
  fetchedAt: Date.now(),
});

describe('DiskTocCache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ris-toc-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a stored TOC', async () => {
    const cache = new DiskTocCache({ dir });
    await cache.put(sample('https://x/abgb'));
    const got = await cache.get('https://x/abgb');
    expect(got?.entries).toEqual([{ paragraph: '1295', heading: 'Schadenersatz' }]);
  });

  it('returns null for an unknown key', async () => {
    const cache = new DiskTocCache({ dir });
    expect(await cache.get('https://x/never')).toBeNull();
  });

  it('treats a corrupt cache file as a miss and removes it', async () => {
    const cache = new DiskTocCache({ dir });
    await cache.put(sample('https://x/corrupt'));
    const [file] = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    // A truncated write leaves valid JSON without the expected shape.
    await writeFile(join(dir, file!), '{"entries":null}');
    expect(await cache.get('https://x/corrupt')).toBeNull();
    expect((await readdir(dir)).filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('treats an entry older than the TTL as a miss', async () => {
    const cache = new DiskTocCache({ dir, ttlMs: 1000 });
    await cache.put({ ...sample('https://x/stale'), fetchedAt: Date.now() - 10_000 });
    expect(await cache.get('https://x/stale')).toBeNull();
  });

  it('evicts the least-recently-used entries beyond the cap', async () => {
    const cache = new DiskTocCache({ dir, maxEntries: 2 });
    await cache.put(sample('https://x/a'));
    await cache.put(sample('https://x/b'));
    await cache.put(sample('https://x/c'));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeLessThanOrEqual(2);
  });

  it('enforces a shared byte budget independently of the entry-count cap', async () => {
    const first = { ...sample('https://x/bytes-a'), title: 'A'.repeat(300) };
    const oneEntryBytes = Buffer.byteLength(JSON.stringify(first), 'utf8');
    const maxBytes = oneEntryBytes + 32;
    const cache = new DiskTocCache({
      dir,
      maxEntries: 10,
      maxEntryBytes: oneEntryBytes + 128,
      maxBytes,
    });

    await cache.put(first);
    await cache.put({ ...sample('https://x/bytes-b'), title: 'B'.repeat(300) });

    const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
    const totalBytes = (await Promise.all(files.map((file) => stat(join(dir, file)))))
      .reduce((sum, metadata) => sum + metadata.size, 0);
    expect(files).toHaveLength(1);
    expect(totalBytes).toBeLessThanOrEqual(maxBytes);
  });

  it('refuses a candidate larger than the per-entry limit without disturbing existing data', async () => {
    const cache = new DiskTocCache({ dir, maxEntryBytes: 256, maxBytes: 4_096 });
    const existing = sample('https://x/existing');
    await cache.put(existing);

    await expect(cache.put({
      ...sample('https://x/oversized'),
      title: 'X'.repeat(1_024),
    })).rejects.toThrow('exceeds 256 bytes');

    await expect(cache.get(existing.url)).resolves.toEqual(existing);
    expect((await readdir(dir)).filter((file) => file.endsWith('.json'))).toHaveLength(1);
  });

  it('drops a legacy oversized entry before JSON parsing', async () => {
    const cache = new DiskTocCache({ dir, maxEntryBytes: 256, maxBytes: 4_096 });
    const url = 'https://x/legacy-oversized';
    await cache.put(sample(url));
    const [file] = (await readdir(dir)).filter((name) => name.endsWith('.json'));
    await writeFile(join(dir, file!), JSON.stringify({ payload: 'X'.repeat(2_048) }));

    await expect(cache.get(url)).resolves.toBeNull();
    expect((await readdir(dir)).filter((name) => name.endsWith('.json'))).toHaveLength(0);
  });

  it('serializes racing puts from dynamically isolated module instances', async () => {
    vi.resetModules();
    const { DiskTocCache: CacheA } = await import('./toc-cache.js');
    vi.resetModules();
    const { DiskTocCache: CacheB } = await import('./toc-cache.js');
    const limits = {
      dir,
      maxEntries: 3,
      maxEntryBytes: 2_048,
      maxBytes: 1_500,
    };
    const cacheA = new CacheA(limits);
    const cacheB = new CacheB(limits);

    await Promise.all(Array.from({ length: 16 }, (_, index) => {
      const cache = index % 2 === 0 ? cacheA : cacheB;
      return cache.put({
        ...sample(`https://x/race-${index}`),
        title: String(index).repeat(300),
      });
    }));

    const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
    const totalBytes = (await Promise.all(files.map((file) => stat(join(dir, file)))))
      .reduce((sum, metadata) => sum + metadata.size, 0);
    expect(files.length).toBeLessThanOrEqual(limits.maxEntries);
    expect(totalBytes).toBeLessThanOrEqual(limits.maxBytes);
  });

  it('never lets a racing stale delete remove a fresh cross-instance put', async () => {
    vi.resetModules();
    const { DiskTocCache: CacheA } = await import('./toc-cache.js');
    vi.resetModules();
    const { DiskTocCache: CacheB } = await import('./toc-cache.js');
    // Keep the stale/fresh distinction independent of runner throughput: this
    // test deliberately serializes many cross-instance filesystem transactions.
    const ttlMs = 60 * 60 * 1_000;
    const cacheA = new CacheA({ dir, ttlMs });
    const cacheB = new CacheB({ dir, ttlMs });
    const urls = Array.from({ length: 8 }, (_, index) => `https://x/stale-race-${index}`);
    await Promise.all(urls.map((url) => cacheA.put({
      ...sample(url),
      fetchedAt: Date.now() - (2 * ttlMs),
    })));

    const freshAt = Date.now();
    await Promise.all(urls.flatMap((url) => [
      cacheA.get(url),
      cacheB.put({ ...sample(url), fetchedAt: freshAt }),
    ]));

    await Promise.all(urls.map(async (url) => {
      expect((await cacheA.get(url))?.fetchedAt).toBe(freshAt);
    }));
  });
});
