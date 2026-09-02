import { mkdir, readdir, lstat, unlink } from 'fs/promises';
import { createHash } from 'crypto';
import type { TocSection, DocumentDetail } from './client.js';
import { cachePath } from '../../shared/state-paths.js';
import {
  atomicWriteJson,
  readUtf8FileBounded,
  withFileTransactionLock,
} from '../../shared/persistence.js';
import { nautosConfig } from './config.js';
import { nautosEntitlementCacheScope } from './cache-scope.js';

export const NAUTOS_ENTITLEMENT_SCOPE = nautosEntitlementCacheScope(nautosConfig);
const CACHE_DIR = cachePath('nautos', 'identities', NAUTOS_ENTITLEMENT_SCOPE);
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES = 500;
const CACHE_ENTRY_NAME_PATTERN = /^[a-f0-9]{16}\.json$/;
export const NAUTOS_MAX_SECTION_BYTES = 8 * 1024 * 1024;
export const NAUTOS_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const NAUTOS_MAX_CACHE_BYTES = 512 * 1024 * 1024;
const TRANSACTION_LOCK_PATH = `${CACHE_DIR}.transaction.lock`;

export interface CachedDocument {
  acCode: string;
  din21Id: string;
  detail: DocumentDetail;
  toc: TocSection[];
  sections: Record<string, string>; // sectionId → markdown
  fetchedAt: number;
}

function docPath(acCode: string): string {
  const hash = createHash('sha256').update(acCode).digest('hex').slice(0, 16);
  return cacheEntryPath(`${hash}.json`);
}

function cacheEntryPath(filename: string): string {
  if (!CACHE_ENTRY_NAME_PATTERN.test(filename)) {
    throw new Error('Invalid nautos cache entry name');
  }
  return cachePath('nautos', 'identities', NAUTOS_ENTITLEMENT_SCOPE, filename);
}

async function ensureDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

function byteSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function serializeBounded(doc: CachedDocument): string {
  const serialized = JSON.stringify(doc);
  const size = byteSize(serialized);
  if (size > NAUTOS_MAX_DOCUMENT_BYTES) {
    throw new RangeError(
      `nautos cached document exceeds ${NAUTOS_MAX_DOCUMENT_BYTES} bytes`,
    );
  }
  return serialized;
}

function isSections(value: unknown): value is Record<string, string> {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.entries(value).every(([key, section]) => (
      key.length > 0
      && typeof section === 'string'
      && byteSize(section) <= NAUTOS_MAX_SECTION_BYTES
    ));
}

function isCachedDocument(value: unknown, acCode: string): value is CachedDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const doc = value as Partial<CachedDocument>;
  return doc.acCode === acCode
    && typeof doc.din21Id === 'string'
    && !!doc.detail
    && typeof doc.detail === 'object'
    && Array.isArray(doc.toc)
    && isSections(doc.sections)
    && Number.isFinite(doc.fetchedAt);
}

async function readUnlocked(acCode: string, touch: boolean): Promise<CachedDocument | null> {
  try {
    const path = docPath(acCode);
    let cached: CachedDocument | null = null;
    await readUtf8FileBounded(path, NAUTOS_MAX_DOCUMENT_BYTES, {
      touchWhen: (raw) => {
        const value = JSON.parse(raw) as unknown;
        if (!isCachedDocument(value, acCode)) return false;
        if (Date.now() - value.fetchedAt > TTL_MS) return false;
        cached = value;
        return touch;
      },
    });
    return cached;
  } catch {
    return null;
  }
}

export async function get(acCode: string): Promise<CachedDocument | null> {
  return withFileTransactionLock(
    TRANSACTION_LOCK_PATH,
    () => readUnlocked(acCode, true),
  );
}

export async function put(doc: CachedDocument): Promise<void> {
  await withFileTransactionLock(TRANSACTION_LOCK_PATH, async () => {
    await ensureDir();
    // A metadata refresh must not discard sections another MCP process fetched
    // while this caller held an older in-memory copy.
    const current = await readUnlocked(doc.acCode, false);
    const merged: CachedDocument = current
      ? { ...doc, sections: { ...current.sections, ...doc.sections } }
      : doc;
    serializeBounded(merged);
    await atomicWriteJson(docPath(doc.acCode), merged, { serialize: true });
    await evictUnlocked();
  });
}

export async function putSection(acCode: string, sectionId: string, markdown: string): Promise<void> {
  if (byteSize(markdown) > NAUTOS_MAX_SECTION_BYTES) {
    throw new RangeError(`nautos section exceeds ${NAUTOS_MAX_SECTION_BYTES} bytes`);
  }
  await withFileTransactionLock(TRANSACTION_LOCK_PATH, async () => {
    const doc = await readUnlocked(acCode, false);
    if (!doc) return;
    doc.sections[sectionId] = markdown;
    serializeBounded(doc);
    await atomicWriteJson(docPath(acCode), doc, { serialize: true });
    await evictUnlocked();
  });
}

async function evictUnlocked(): Promise<void> {
  try {
    const files = (await readdir(CACHE_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && CACHE_ENTRY_NAME_PATTERN.test(entry.name))
      .map((entry) => entry.name);
    const entries = await Promise.all(
      files.map(async (filename) => {
        const p = cacheEntryPath(filename);
        const s = await lstat(p);
        return { path: p, mtime: s.mtimeMs, size: s.size };
      }),
    );
    entries.sort((a, b) => a.mtime - b.mtime);
    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    let count = entries.length;
    for (const entry of entries) {
      if (count <= MAX_ENTRIES && totalBytes <= NAUTOS_MAX_CACHE_BYTES) break;
      await unlink(entry.path).catch(() => undefined);
      count--;
      totalBytes -= entry.size;
    }
  } catch { /* best effort */ }
}
