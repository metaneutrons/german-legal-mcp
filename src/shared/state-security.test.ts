import { chmod, lstat, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensurePrivateDirectory } from './state-security.js';

describe('private state directories', () => {
  const paths: string[] = [];

  afterEach(async () => {
    await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('creates owner-only directories on POSIX', async () => {
    const root = await mkdtemp(join(tmpdir(), 'glmcp-state-'));
    paths.push(root);
    const nested = join(root, 'private');
    await ensurePrivateDirectory(nested);
    expect((await lstat(nested)).isDirectory()).toBe(true);
    if (process.platform !== 'win32') {
      expect((await lstat(nested)).mode & 0o777).toBe(0o700);
    }
  });

  it('rejects a symbolic-link state directory', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'glmcp-state-'));
    const target = await mkdtemp(join(tmpdir(), 'glmcp-state-target-'));
    paths.push(root, target);
    const linked = join(root, 'linked');
    await symlink(target, linked);
    await expect(ensurePrivateDirectory(linked)).rejects.toThrow('symbolic-link state directory');
  });

  it('never tightens an arbitrary existing shared directory implicitly', async () => {
    if (process.platform === 'win32') return;
    const existing = await mkdtemp(join(tmpdir(), 'glmcp-shared-'));
    paths.push(existing);
    await chmod(existing, 0o755);

    await expect(ensurePrivateDirectory(existing))
      .rejects.toThrow('Refusing to change permissions on existing state directory');
    expect((await lstat(existing)).mode & 0o777).toBe(0o755);
  });

  it('rejects an existing private directory owned by another uid', async () => {
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
    const existing = await mkdtemp(join(tmpdir(), 'glmcp-foreign-'));
    paths.push(existing);
    await chmod(existing, 0o700);
    const actualUid = process.getuid();
    const getuid = vi.spyOn(process, 'getuid').mockReturnValue(actualUid + 1);
    try {
      await expect(ensurePrivateDirectory(existing)).rejects.toThrow(/owned by uid/i);
    } finally {
      getuid.mockRestore();
    }
  });
});
