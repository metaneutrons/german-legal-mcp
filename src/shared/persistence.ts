import {
  chmod,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  type Stats,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  ensurePrivateChildDirectory,
  ensurePrivateDirectory,
} from './state-security.js';

export interface AtomicWriteOptions {
  fileMode?: number;
  directoryMode?: number;
  serialize?: boolean;
}

export interface ReadJsonOptions<T> {
  validate?: (value: unknown) => value is T;
  quarantineCorrupt?: boolean;
  /** Refuse the file before allocating/parsing content beyond this byte cap. */
  maxBytes?: number;
}

export interface ReadUtf8FileBoundedOptions {
  /** Refresh access/eviction timestamps on the already-open inode. */
  touch?: boolean;
  /** Refresh only when the fully read, stable payload passes caller validation. */
  touchWhen?: (contents: string) => boolean;
}

export class InvalidPersistedDataError extends Error {
  constructor(
    readonly path: string,
    readonly quarantinedPath?: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid persisted JSON: ${path}`, options);
    this.name = 'InvalidPersistedDataError';
  }
}

const writeQueues = new Map<string, Promise<void>>();

export class PersistedDataLimitError extends Error {
  constructor(readonly maxBytes: number, readonly actualBytes: number) {
    super(`Persisted JSON exceeds ${maxBytes} bytes (${actualBytes})`);
    this.name = 'PersistedDataLimitError';
  }
}

class PersistedDataChangedError extends Error {
  constructor() {
    super('Persisted file changed while it was being read');
    this.name = 'PersistedDataChangedError';
  }
}

function assertPersistedMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('Persisted file maxBytes must be a positive safe integer');
  }
}

function assertPinnedPersistedFile(metadata: Stats, maxBytes: number): void {
  if (!metadata.isFile() || metadata.nlink !== 1) {
    throw new Error('Persisted path must select one regular file');
  }
  if (metadata.size > maxBytes) {
    throw new PersistedDataLimitError(maxBytes, metadata.size);
  }
}

function assertPersistedFileUnchanged(
  before: Stats,
  after: Stats,
  bytesRead: number,
  extraBytes: number,
): void {
  if (
    bytesRead !== before.size
    || extraBytes !== 0
    || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs
    || after.ctimeMs !== before.ctimeMs
  ) {
    throw new PersistedDataChangedError();
  }
}

/**
 * Read one UTF-8 persistence artifact through a pinned inode after rejecting an
 * oversized file from metadata. The post-read check also fails closed if a
 * non-atomic external writer grew the already-open inode concurrently.
 */
export async function readUtf8FileBounded(
  path: string,
  maxBytes: number,
  options: ReadUtf8FileBoundedOptions = {},
): Promise<string> {
  assertPersistedMaxBytes(maxBytes);
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const metadata = await handle.stat();
    assertPinnedPersistedFile(metadata, maxBytes);
    // Allocate only the metadata-bounded payload. A separate one-byte read
    // proves EOF without permitting a concurrently growing writer to expand
    // the payload allocation beyond the configured ceiling.
    const buffer = Buffer.allocUnsafe(metadata.size);
    let total = 0;
    while (total < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.byteLength - total,
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const sentinel = Buffer.allocUnsafe(1);
    const { bytesRead: extraBytes } = await handle.read(sentinel, 0, 1, null);
    const afterRead = await handle.stat();
    assertPersistedFileUnchanged(metadata, afterRead, total, extraBytes);
    const contents = buffer.subarray(0, total).toString('utf8');
    if (options.touch || options.touchWhen?.(contents) === true) {
      const now = new Date();
      await handle.utimes(now, now).catch(() => undefined);
    }
    return contents;
  } finally {
    await handle.close();
  }
}

/** Synchronous counterpart for constructor-time state that cannot be loaded lazily. */
export function readUtf8FileBoundedSync(path: string, maxBytes: number): string {
  assertPersistedMaxBytes(maxBytes);
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const descriptor = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const metadata = fstatSync(descriptor);
    assertPinnedPersistedFile(metadata, maxBytes);
    const buffer = Buffer.allocUnsafe(metadata.size);
    let total = 0;
    while (total < buffer.byteLength) {
      const bytesRead = readSync(
        descriptor,
        buffer,
        total,
        buffer.byteLength - total,
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const sentinel = Buffer.allocUnsafe(1);
    const extraBytes = readSync(descriptor, sentinel, 0, 1, null);
    const afterRead = fstatSync(descriptor);
    assertPersistedFileUnchanged(metadata, afterRead, total, extraBytes);
    return buffer.subarray(0, total).toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

export interface FileTransactionLockOptions {
  timeoutMs?: number;
  pollMs?: number;
}

async function waitForLockPoll(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = globalThis.setTimeout(resolve, ms);
    timer.unref();
  });
}

/**
 * Run a complete read-modify-write transaction under a cross-process lock.
 *
 * Atomic rename makes one file write indivisible, but it cannot make a
 * load→mutate→save sequence indivisible: two MCP host processes could both
 * load the same index and the last rename would silently discard the other's
 * update.
 *
 * Filesystem stale-lock deletion cannot be made compare-and-swap safe with the
 * portable Node filesystem API: two reclaimers can inspect an old inode and
 * one can later delete its replacement. Instead, SQLite's `BEGIN IMMEDIATE`
 * supplies a real OS advisory lock on a database inside the owner-only state
 * root. The kernel releases it on normal close *and* process death, while the
 * persistent empty database is not itself an ownership claim. This avoids
 * stale reclaimer races and does not expose a machine-global TCP namespace.
 */
export async function withFileTransactionLock<T>(
  path: string,
  operation: () => Promise<T>,
  options: FileTransactionLockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollMs = options.pollMs ?? 25;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('File transaction lock timeout must be positive');
  }
  if (!Number.isFinite(pollMs) || pollMs <= 0) {
    throw new TypeError('File transaction lock poll interval must be positive');
  }

  await ensurePrivateChildDirectory(dirname(path));
  const deadline = Date.now() + timeoutMs;
  const databasePath = `${path}.sqlite3`;
  let database: DatabaseSync | null = null;

  try {
    while (database === null) {
      const candidate = new DatabaseSync(databasePath);
      try {
        candidate.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
        database = candidate;
        await chmod(databasePath, 0o600);
      } catch (error) {
        candidate.close();
        if (!isSqliteBusy(error)) throw error;
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for file transaction lock: ${path}`, {
            cause: error,
          });
        }
        await waitForLockPoll(Math.min(pollMs, Math.max(1, deadline - Date.now())));
      }
    }
    return await operation();
  } finally {
    if (database !== null) {
      try {
        database.exec('ROLLBACK');
      } finally {
        database.close();
      }
    }
  }
}

function isSqliteBusy(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'ERR_SQLITE_ERROR'
    && (error as { errcode?: unknown }).errcode === 5;
}

async function writeAtomic(
  path: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions,
): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const directoryMode = options.directoryMode ?? 0o700;
  const fileMode = options.fileMode ?? 0o600;
  if (options.directoryMode === undefined) {
    await ensurePrivateChildDirectory(directory);
  } else if (directoryMode === 0o700) {
    await ensurePrivateDirectory(directory);
  } else {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(directory, { recursive: true, mode: directoryMode });
    await chmod(directory, directoryMode);
  }

  try {
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
    const handle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      fileMode,
    );
    try {
      await handle.writeFile(data);
      if (process.platform !== 'win32') await handle.chmod(fileMode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function atomicWriteFile(
  path: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  if (!options.serialize) {
    await writeAtomic(path, data, options);
    return;
  }

  const previous = writeQueues.get(path) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => writeAtomic(path, data, options));
  writeQueues.set(path, current);

  try {
    await current;
  } finally {
    if (writeQueues.get(path) === current) {
      writeQueues.delete(path);
    }
  }
}

export async function atomicWriteJson(
  path: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await atomicWriteFile(path, JSON.stringify(value), options);
}

export async function readJsonFile<T>(
  path: string,
  options: ReadJsonOptions<T> = {},
): Promise<T> {
  try {
    let serialized: string;
    if (options.maxBytes === undefined) {
      serialized = await readFile(path, 'utf-8');
    } else {
      serialized = await readUtf8FileBounded(path, options.maxBytes);
    }
    const value = JSON.parse(serialized) as unknown;
    if (options.validate && !options.validate(value)) {
      throw new TypeError('Persisted JSON failed validation');
    }
    return value as T;
  } catch (error) {
    let quarantinedPath: string | undefined;
    const invalidData = error instanceof SyntaxError
      || error instanceof PersistedDataLimitError
      || error instanceof PersistedDataChangedError
      || (
      error instanceof TypeError
      && error.message === 'Persisted JSON failed validation'
      );
    if (options.quarantineCorrupt && invalidData) {
      quarantinedPath = `${path}.corrupt.${Date.now()}.${randomUUID()}`;
      await rename(path, quarantinedPath).catch(() => {
        quarantinedPath = undefined;
      });
    }
    if (invalidData) {
      throw new InvalidPersistedDataError(path, quarantinedPath, { cause: error });
    }
    throw error;
  }
}
