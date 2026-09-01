import { constants, type Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ToolResult } from './types.js';
import { getExportDir } from './state-paths.js';

interface DirectoryIdentity {
  path: string;
  dev: number;
  ino: number;
  handle: FileHandle | undefined;
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}

function sameIdentity(left: Pick<Stats, 'dev' | 'ino'>, right: Pick<Stats, 'dev' | 'ino'>): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertSafeExportDirectory(path: string, metadata: Stats): void {
  if (metadata.isSymbolicLink()) {
    throw new Error(`save_path contains a symbolic-link directory: ${path}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`save_path parent is not a directory: ${path}`);
  }
  if (process.platform === 'win32') return;
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (currentUid !== undefined && metadata.uid !== currentUid) {
    throw new Error(
      `Refusing export directory owned by uid ${metadata.uid}: ${path}. `
      + `It must be owned by the current uid ${currentUid}.`,
    );
  }
  if ((metadata.mode & 0o022) !== 0) {
    throw new Error(
      `Refusing group/world-writable export directory: ${path}. `
      + 'Remove group and other write permissions before use.',
    );
  }
}

async function ensureExportRoot(configuredRoot: string): Promise<string> {
  await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
  const before = await lstat(configuredRoot);
  assertSafeExportDirectory(configuredRoot, before);
  let handle: FileHandle | undefined;
  try {
    if (process.platform !== 'win32') {
      const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
      const directory = 'O_DIRECTORY' in constants ? constants.O_DIRECTORY : 0;
      handle = await open(configuredRoot, constants.O_RDONLY | noFollow | directory);
      const opened = await handle.stat();
      assertSafeExportDirectory(configuredRoot, opened);
      if (!sameIdentity(before, opened)) {
        throw new Error(`Export directory changed while it was being validated: ${configuredRoot}`);
      }
    }
    const resolved = await realpath(configuredRoot);
    const [resolvedMetadata, after] = await Promise.all([
      lstat(resolved),
      lstat(configuredRoot),
    ]);
    assertSafeExportDirectory(resolved, resolvedMetadata);
    assertSafeExportDirectory(configuredRoot, after);
    if (!sameIdentity(before, resolvedMetadata) || !sameIdentity(before, after)) {
      throw new Error(`Export directory changed while it was being validated: ${configuredRoot}`);
    }
    return resolved;
  } finally {
    await handle?.close();
  }
}

async function ensureSafeParents(root: string, parent: string): Promise<string[]> {
  const rel = relative(root, parent);
  if (!isContained(root, parent)) throw new Error('save_path escapes the configured export directory');
  const paths = [root];
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error;
    }
    const metadata = await lstat(current);
    assertSafeExportDirectory(current, metadata);
    paths.push(current);
  }

  const resolvedParent = await realpath(parent);
  if (!isContained(root, resolvedParent)) {
    throw new Error('save_path resolves outside the configured export directory');
  }
  return paths;
}

async function captureDirectoryIdentities(paths: string[]): Promise<DirectoryIdentity[]> {
  const identities: DirectoryIdentity[] = [];
  try {
    for (const path of paths) {
      const before = await lstat(path);
      assertSafeExportDirectory(path, before);
      let handle: FileHandle | undefined;
      if (process.platform !== 'win32') {
        try {
          const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
          const directory = 'O_DIRECTORY' in constants ? constants.O_DIRECTORY : 0;
          handle = await open(path, constants.O_RDONLY | noFollow | directory);
          const opened = await handle.stat();
          assertSafeExportDirectory(path, opened);
          const after = await lstat(path);
          if (!sameIdentity(before, opened) || !sameIdentity(opened, after)) {
            throw new Error(`Export directory changed while it was being validated: ${path}`);
          }
        } catch (error) {
          await handle?.close();
          throw error;
        }
      }
      identities.push({ path, dev: before.dev, ino: before.ino, handle });
    }
    return identities;
  } catch (error) {
    await Promise.all(identities.map((identity) => identity.handle?.close()));
    throw error;
  }
}

async function validateDirectoryIdentities(
  root: string,
  identities: DirectoryIdentity[],
): Promise<void> {
  for (const identity of identities) {
    const current = await lstat(identity.path);
    assertSafeExportDirectory(identity.path, current);
    if (current.dev !== identity.dev || current.ino !== identity.ino) {
      throw new Error(`Export directory changed before the file could be created: ${identity.path}`);
    }
    if (identity.handle) {
      const opened = await identity.handle.stat();
      if (!sameIdentity(current, opened)) {
        throw new Error(`Export directory changed before the file could be created: ${identity.path}`);
      }
    }
  }
  const parent = identities.at(-1)?.path;
  if (!parent || !isContained(root, await realpath(parent))) {
    throw new Error('save_path resolves outside the configured export directory');
  }
}

async function assertOpenedTargetStillSelected(target: string, opened: Stats): Promise<void> {
  const selected = await lstat(target);
  if (selected.isSymbolicLink() || !selected.isFile() || !sameIdentity(selected, opened)) {
    throw new Error(`save_path changed while the file was being created: ${target}`);
  }
}

async function unlinkOpenedTargetIfStillSelected(target: string, opened: Stats): Promise<void> {
  try {
    const selected = await lstat(target);
    if (sameIdentity(selected, opened)) await unlink(target);
  } catch {
    // The content is truncated through the still-open handle below; never
    // unlink a pathname whose identity we can no longer prove.
  }
}

/**
 * Save content to a file and return a metadata-only ToolResult.
 * Shared helper for the `save_path` pattern used across all providers.
 *
 * @param savePath - Destination file path
 * @param content - Content to write
 * @param meta - Additional metadata lines to include in the response
 */
export async function saveToFile(savePath: string, content: string, meta?: string): Promise<ToolResult> {
  if (!isAbsolute(savePath)) {
    throw new Error(
      `save_path must be an absolute path; relative paths are not supported: ${JSON.stringify(savePath)}`,
    );
  }

  const configuredRoot = resolve(getExportDir());
  // Existing caller-owned directories retain safe team-read permissions, but
  // every component controlled by the export root must be owned by this uid
  // and must not be writable by group/other.
  const root = await ensureExportRoot(configuredRoot);
  const lexicalRelative = relative(configuredRoot, resolve(savePath));
  if (lexicalRelative === '..' || lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)) {
    throw new Error(
      `save_path must be inside GLMCP_EXPORT_DIR (${configuredRoot}): ${JSON.stringify(savePath)}`,
    );
  }
  const target = resolve(root, lexicalRelative);
  const parent = dirname(target);
  const parentPaths = await ensureSafeParents(root, parent);
  const parentIdentities = await captureDirectoryIdentities(parentPaths);

  try {
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink()) throw new Error(`save_path must not be a symbolic link: ${savePath}`);
      throw new Error(`save_path already exists; refusing to overwrite it: ${savePath}`);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    }

    // Node has no portable openat(2). Keep every validated directory inode
    // open, revalidate the full chain immediately before O_EXCL, and create an
    // empty file first. No content is written until the opened inode is proven
    // to be the pathname selected through the still-identical parent chain.
    await validateDirectoryIdentities(root, parentIdentities);
    const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
    const handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    let opened: Stats | undefined;
    try {
      opened = await handle.stat();
      if (!opened.isFile()) throw new Error(`save_path is not a regular file: ${target}`);
      await validateDirectoryIdentities(root, parentIdentities);
      await assertOpenedTargetStillSelected(target, opened);
      if (process.platform !== 'win32') await handle.chmod(0o600);
      await handle.writeFile(content, { encoding: 'utf-8' });
      await handle.sync();
      await validateDirectoryIdentities(root, parentIdentities);
      await assertOpenedTargetStillSelected(target, opened);
    } catch (error) {
      // Fail closed if a parent changes at any point: erase the opened inode,
      // even when its pathname has been moved, before attempting safe cleanup.
      await handle.truncate(0).catch(() => undefined);
      await handle.sync().catch(() => undefined);
      const cleanupIdentity = opened ?? await handle.stat().catch(() => undefined);
      if (cleanupIdentity) await unlinkOpenedTargetIfStillSelected(target, cleanupIdentity);
      throw error;
    } finally {
      await handle.close();
    }
  } finally {
    await Promise.all(parentIdentities.map((identity) => identity.handle?.close()));
  }

  const msg = `Saved to ${resolve(savePath)} (${content.length} chars)${meta ? `\n\n${meta}` : ''}`;
  return { content: [{ type: 'text', text: msg }] };
}
