import { join } from 'node:path';
import { lstat, readdir, unlink, utimes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cachePath } from '../../shared/state-paths.js';
import {
  atomicWriteFile,
  InvalidPersistedDataError,
  readJsonFile,
  withFileTransactionLock,
} from '../../shared/persistence.js';
import type { RisTocEntry } from './toc.js';

const CACHE_DIR = cachePath('ris-toc');
/** A consolidated law's structure is stable for months; a navigation aid can be stale. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES = 200;
export const RIS_TOC_MAX_ENTRY_BYTES = 8 * 1024 * 1024;
export const RIS_TOC_MAX_CACHE_BYTES = 64 * 1024 * 1024;

export interface CachedToc {
  /** The whole-law ("Gesamte Rechtsvorschrift") URL this TOC was parsed from — the cache key. */
  url: string;
  title: string;
  entries: RisTocEntry[];
  fetchedAt: number;
}

/**
 * A table-of-contents cache. Parsing a law's TOC means fetching its whole-law
 * HTML, which RIS generates server-side and can take ~20 s for a large code
 * (ABGB). The structure changes rarely, so the result is cached and that cost
 * is paid at most once per law per TTL.
 */
export interface RisTocCache {
  get(url: string): Promise<CachedToc | null>;
  put(entry: CachedToc): Promise<void>;
}

export interface DiskTocCacheOptions {
  dir?: string;
  ttlMs?: number;
  maxEntries?: number;
  maxEntryBytes?: number;
  maxBytes?: number;
}

interface CacheFile {
  path: string;
  dev: number;
  ino: number;
  mtime: number;
  size: number;
}

function isCachedToc(value: unknown): value is CachedToc {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<CachedToc>;
  return typeof entry.url === 'string'
    && typeof entry.title === 'string'
    && Number.isFinite(entry.fetchedAt)
    && Array.isArray(entry.entries)
    && entry.entries.every((item): item is RisTocEntry => (
      !!item
      && typeof item === 'object'
      && typeof item.paragraph === 'string'
      && typeof item.heading === 'string'
    ));
}

function safeIntegerOption(value: number, name: string, allowZero: boolean): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new TypeError(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer`);
  }
  return value;
}

/** Disk-backed cache: one JSON file per law under the state cache dir, LRU-evicted. */
export class DiskTocCache implements RisTocCache {
  private readonly dir: string;
  private readonly transactionLockPath: string;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxEntryBytes: number;
  private readonly maxBytes: number;

  constructor(opts: DiskTocCacheOptions = {}) {
    this.dir = opts.dir ?? CACHE_DIR;
    this.transactionLockPath = join(this.dir, '.transaction.lock');
    this.ttlMs = safeIntegerOption(opts.ttlMs ?? TTL_MS, 'ttlMs', true);
    this.maxEntries = safeIntegerOption(opts.maxEntries ?? MAX_ENTRIES, 'maxEntries', true);
    this.maxEntryBytes = safeIntegerOption(
      opts.maxEntryBytes ?? RIS_TOC_MAX_ENTRY_BYTES,
      'maxEntryBytes',
      false,
    );
    this.maxBytes = safeIntegerOption(
      opts.maxBytes ?? RIS_TOC_MAX_CACHE_BYTES,
      'maxBytes',
      false,
    );
  }

  private filePath(url: string): string {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
    return join(this.dir, `${hash}.json`);
  }

  async get(url: string): Promise<CachedToc | null> {
    return withFileTransactionLock(this.transactionLockPath, async () => {
      const path = this.filePath(url);
      let doc: CachedToc;
      try {
        // readJsonFile opens and stats one inode before allocating/parsing it.
        // This re-read happens only after the cross-process lock is owned.
        doc = await readJsonFile<CachedToc>(path, {
          maxBytes: this.maxEntryBytes,
          validate: isCachedToc,
        });
      } catch (error) {
        if (error instanceof InvalidPersistedDataError) {
          await unlink(path).catch((unlinkError: unknown) => {
            if (!hasErrorCode(unlinkError, 'ENOENT')) throw unlinkError;
          });
        }
        return null;
      }
      if (doc.url !== url || Date.now() - doc.fetchedAt > this.ttlMs) {
        await unlink(path).catch((error: unknown) => {
          if (!hasErrorCode(error, 'ENOENT')) throw error;
        });
        return null;
      }
      const now = new Date();
      await utimes(path, now, now).catch((error: unknown) => {
        if (!hasErrorCode(error, 'ENOENT')) throw error;
      });
      return doc;
    }).catch((error: unknown) => {
      if (hasErrorCode(error, 'ENOENT')) return null;
      throw error;
    });
  }

  async put(entry: CachedToc): Promise<void> {
    if (!isCachedToc(entry)) throw new TypeError('Invalid RIS TOC cache entry');
    const serialized = JSON.stringify(entry);
    const candidateBytes = Buffer.byteLength(serialized, 'utf8');
    if (candidateBytes > this.maxEntryBytes) {
      throw new RangeError(`RIS TOC cache entry exceeds ${this.maxEntryBytes} bytes`);
    }
    if (candidateBytes > this.maxBytes) {
      throw new RangeError(`RIS TOC cache entry exceeds the ${this.maxBytes}-byte cache budget`);
    }
    await withFileTransactionLock(this.transactionLockPath, async () => {
      await atomicWriteFile(this.filePath(entry.url), serialized);
      // Inventory and eviction are part of the same transaction as the put;
      // every size/mtime is loaded anew after waiting for the SQLite lock.
      await this.evictUnlocked();
    });
  }

  private async removeIfUnchanged(entry: CacheFile): Promise<boolean> {
    try {
      const current = await lstat(entry.path);
      if (current.dev !== entry.dev || current.ino !== entry.ino) return false;
      await unlink(entry.path);
      return true;
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return true;
      throw error;
    }
  }

  private async evictUnlocked(): Promise<void> {
    const files = (await readdir(this.dir)).filter((file) => file.endsWith('.json'));
    const entries = (await Promise.all(files.map(async (file): Promise<CacheFile | null> => {
      const path = join(this.dir, file);
      try {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
        return {
          path,
          dev: metadata.dev,
          ino: metadata.ino,
          mtime: metadata.mtimeMs,
          size: metadata.size,
        };
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) return null;
        throw error;
      }
    }))).filter((entry): entry is CacheFile => entry !== null);
    entries.sort((left, right) => left.mtime - right.mtime || left.path.localeCompare(right.path));

    const survivors: CacheFile[] = [];
    for (const entry of entries) {
      if (entry.size <= this.maxEntryBytes) {
        survivors.push(entry);
      } else {
        await this.removeIfUnchanged(entry);
      }
    }

    let count = survivors.length;
    let totalBytes = survivors.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of survivors) {
      if (count <= this.maxEntries && totalBytes <= this.maxBytes) break;
      if (await this.removeIfUnchanged(entry)) {
        count--;
        totalBytes -= entry.size;
      }
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return !!error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === code;
}
