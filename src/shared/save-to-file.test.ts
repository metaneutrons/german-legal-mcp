import { renameSync, symlinkSync } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveToFile } from './save-to-file.js';

describe('saveToFile', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes content to an absolute path and creates parent directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-'));
    directories.push(dir);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);
    const path = join(dir, 'nested', 'document.md');

    const result = await saveToFile(path, '# Document');

    expect(result.content[0]?.text).toContain(`Saved to ${path}`);
    expect(await readFile(path, 'utf-8')).toBe('# Document');
  });

  it('rejects relative paths with an actionable error', async () => {
    await expect(saveToFile('research/document.md', '# Document')).rejects.toThrow(
      'save_path must be an absolute path',
    );
  });

  it('rejects paths outside the configured export root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'save-to-file-outside-'));
    directories.push(dir, outside);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);

    await expect(saveToFile(join(outside, 'document.md'), '# Document')).rejects.toThrow(
      'must be inside GLMCP_EXPORT_DIR',
    );
  });

  it('never overwrites an existing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-'));
    directories.push(dir);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);
    const path = join(dir, 'document.md');
    await writeFile(path, 'original');

    await expect(saveToFile(path, 'replacement')).rejects.toThrow('refusing to overwrite');
    expect(await readFile(path, 'utf-8')).toBe('original');
  });

  it('rejects symlinked parent directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'save-to-file-outside-'));
    directories.push(dir, outside);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);
    await symlink(outside, join(dir, 'linked'));

    await expect(saveToFile(join(dir, 'linked', 'document.md'), 'secret')).rejects.toThrow(
      'symbolic-link directory',
    );
  });

  it('preserves the caller-owned export root and secures created children and files on POSIX', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-'));
    directories.push(dir);
    await chmod(dir, 0o755);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);
    const path = join(dir, 'nested', 'document.md');

    await saveToFile(path, '# Private');

    expect((await lstat(dir)).mode & 0o777).toBe(0o755);
    expect((await lstat(join(dir, 'nested'))).mode & 0o777).toBe(0o700);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
  });

  it('preserves permissions on an existing caller-owned parent directory', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-'));
    directories.push(dir);
    const shared = join(dir, 'team-shared');
    await mkdir(shared, { mode: 0o750 });
    await chmod(shared, 0o750);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);

    await saveToFile(join(shared, 'document.md'), '# Shared export');

    expect((await lstat(shared)).mode & 0o777).toBe(0o750);
  });

  it('rejects a group/world-writable configured export root', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-writable-'));
    directories.push(dir);
    await chmod(dir, 0o777);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);

    await expect(saveToFile(join(dir, 'document.md'), 'secret')).rejects.toThrow(
      'group/world-writable export directory',
    );
    await expect(access(join(dir, 'document.md'))).rejects.toThrow();
  });

  it('rejects a group/world-writable existing parent below the export root', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-writable-parent-'));
    directories.push(dir);
    const shared = join(dir, 'unsafe');
    await mkdir(shared, { mode: 0o777 });
    await chmod(shared, 0o777);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);

    await expect(saveToFile(join(shared, 'document.md'), 'secret')).rejects.toThrow(
      'group/world-writable export directory',
    );
  });

  it('rejects an export root not owned by the current uid', async () => {
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-owner-'));
    directories.push(dir);
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);
    const actualUid = process.getuid();
    vi.spyOn(process, 'getuid').mockReturnValue(actualUid + 1);

    await expect(saveToFile(join(dir, 'document.md'), 'secret')).rejects.toThrow(
      /owned by uid/i,
    );
  });

  it('fails closed when a validated parent is swapped for a symlink before O_EXCL', async () => {
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
    const dir = await mkdtemp(join(tmpdir(), 'save-to-file-swap-'));
    const outside = await mkdtemp(join(tmpdir(), 'save-to-file-swap-outside-'));
    directories.push(dir, outside);
    const nested = join(dir, 'nested');
    const moved = join(dir, 'nested-original');
    await mkdir(nested, { mode: 0o700 });
    vi.stubEnv('GLMCP_EXPORT_DIR', dir);
    const actualUid = process.getuid();
    let ownerChecks = 0;
    vi.spyOn(process, 'getuid').mockImplementation(() => {
      ownerChecks++;
      // Root + nested have both been lstat/fstat-pinned by nine checks. Swap
      // during the final chain validation immediately before O_EXCL.
      if (ownerChecks === 10) {
        renameSync(nested, moved);
        symlinkSync(outside, nested, 'dir');
      }
      return actualUid;
    });

    await expect(saveToFile(join(nested, 'document.md'), 'secret')).rejects.toThrow(
      /symbolic-link|changed|outside/i,
    );
    await expect(access(join(outside, 'document.md'))).rejects.toThrow();
    await expect(access(join(moved, 'document.md'))).rejects.toThrow();
  });

  it('rejects a symlink used as the configured export root', async () => {
    const target = await mkdtemp(join(tmpdir(), 'save-to-file-target-'));
    const parent = await mkdtemp(join(tmpdir(), 'save-to-file-link-'));
    directories.push(target, parent);
    const rootLink = join(parent, 'export');
    await symlink(target, rootLink);
    vi.stubEnv('GLMCP_EXPORT_DIR', rootLink);

    await expect(saveToFile(join(rootLink, 'document.md'), 'secret')).rejects.toThrow(
      'symbolic-link directory',
    );
  });
});
