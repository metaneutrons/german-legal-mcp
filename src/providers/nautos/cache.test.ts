import { describe, expect, it } from 'vitest';
import { get, put, putSection, type CachedDocument } from './cache.js';
import type { DocumentDetail } from './client.js';

let seq = 0;
function doc(overrides: Partial<CachedDocument> = {}): CachedDocument {
  seq += 1;
  return {
    acCode: `AC-${process.pid}-${seq}`,
    din21Id: 'din-1',
    detail: { title: 'Norm', viewerAccess: false } as unknown as DocumentDetail,
    toc: [],
    sections: {},
    fetchedAt: Date.now(),
    ...overrides,
  };
}

describe('nautos cache', () => {
  it('stores and retrieves a document', async () => {
    const d = doc();
    await put(d);
    const got = await get(d.acCode);
    expect(got?.acCode).toBe(d.acCode);
    expect(got?.detail.title).toBe('Norm');
  });

  it('returns null for an unknown document', async () => {
    await expect(get(`missing-${process.pid}-${seq}`)).resolves.toBeNull();
  });

  it('treats an expired entry as a miss', async () => {
    const stale = doc({ fetchedAt: Date.now() - 40 * 24 * 60 * 60 * 1000 });
    await put(stale);
    await expect(get(stale.acCode)).resolves.toBeNull();
  });

  it('adds a section to an existing cached document', async () => {
    const d = doc();
    await put(d);
    await putSection(d.acCode, 's1', '# Section one');
    const got = await get(d.acCode);
    expect(got?.sections.s1).toBe('# Section one');
  });

  it('ignores a section write for an uncached document', async () => {
    const code = `uncached-${process.pid}-${seq}`;
    await putSection(code, 's1', 'x');
    await expect(get(code)).resolves.toBeNull();
  });
});
