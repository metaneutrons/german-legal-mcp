import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  atomicWriteFile,
  atomicWriteJson,
  InvalidPersistedDataError,
  PersistedDataLimitError,
  readJsonFile,
  readUtf8FileBoundedSync,
  withFileTransactionLock,
} from './persistence.js';

describe('atomic persistence', () => {
  it('writes and replaces JSON without leaving temporary files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glmcp-persistence-'));
    const path = join(dir, 'nested', 'state.json');

    await atomicWriteJson(path, { version: 1 });
    await atomicWriteJson(path, { version: 2 });

    await expect(readJsonFile(path)).resolves.toEqual({ version: 2 });
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(dir, 'nested'))).mode & 0o777).toBe(0o700);
    }
  });

  it('applies restrictive file permissions when requested', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'glmcp-persistence-'));
    const path = join(dir, 'session.json');

    await atomicWriteFile(path, 'secret', {
      directoryMode: 0o700,
      fileMode: 0o600,
    });

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect(await readFile(path, 'utf-8')).toBe('secret');
  });

  it('serializes writes to the same target in invocation order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glmcp-persistence-'));
    const path = join(dir, 'state.json');

    await Promise.all([
      atomicWriteJson(path, { version: 1 }, { serialize: true }),
      atomicWriteJson(path, { version: 2 }, { serialize: true }),
      atomicWriteJson(path, { version: 3 }, { serialize: true }),
    ]);

    await expect(readJsonFile(path)).resolves.toEqual({ version: 3 });
  });

  it('validates persisted JSON and quarantines invalid data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glmcp-persistence-'));
    const path = join(dir, 'session.json');
    await writeFile(path, JSON.stringify({ version: 1 }), 'utf-8');

    await expect(readJsonFile<{ version: 2 }>(path, {
      validate: (value): value is { version: 2 } => (
        typeof value === 'object'
        && value !== null
        && (value as { version?: unknown }).version === 2
      ),
      quarantineCorrupt: true,
    })).rejects.toBeInstanceOf(InvalidPersistedDataError);

    expect((await readdir(dir)).some((name) => name.startsWith('session.json.corrupt.')))
      .toBe(true);
  });

  it('rejects and quarantines oversized JSON before parsing it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glmcp-persistence-'));
    const path = join(dir, 'oversized.json');
    await writeFile(path, JSON.stringify({ payload: 'x'.repeat(4_096) }), 'utf-8');

    await expect(readJsonFile(path, {
      maxBytes: 1_024,
      quarantineCorrupt: true,
    })).rejects.toBeInstanceOf(InvalidPersistedDataError);

    expect((await readdir(dir)).some((name) => name.startsWith('oversized.json.corrupt.')))
      .toBe(true);
  });

  it('bounds synchronous constructor-time reads through the same policy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glmcp-persistence-'));
    const path = join(dir, 'breaker.json');
    await writeFile(path, 'bounded', 'utf-8');

    expect(readUtf8FileBoundedSync(path, 7)).toBe('bounded');
    expect(() => readUtf8FileBoundedSync(path, 6))
      .toThrow(PersistedDataLimitError);
  });

  it('serializes complete read-modify-write operations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'glmcp-persistence-'));
    const lock = join(dir, 'cache.transaction.lock');
    const order: string[] = [];
    let releaseOwner!: () => void;
    const ownerGate = new Promise<void>((resolve) => { releaseOwner = resolve; });

    const owner = withFileTransactionLock(lock, async () => {
      order.push('owner-start');
      await ownerGate;
      order.push('owner-end');
    });
    await expect.poll(() => order).toContain('owner-start');

    const contender = withFileTransactionLock(lock, async () => {
      order.push('contender');
    });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 30));
    expect(order).not.toContain('contender');

    releaseOwner();
    await Promise.all([owner, contender]);
    expect(order.indexOf('contender')).toBeGreaterThan(order.indexOf('owner-end'));
    if (process.platform !== 'win32') {
      expect((await stat(`${lock}.sqlite3`)).mode & 0o777).toBe(0o600);
    }
  });
});
