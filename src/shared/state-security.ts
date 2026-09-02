import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { chmod, lstat, mkdir } from 'node:fs/promises';

function assertDirectory(path: string, symbolic: boolean, directory: boolean): void {
  if (symbolic) throw new Error(`Refusing symbolic-link state directory: ${path}`);
  if (!directory) throw new Error(`State path is not a directory: ${path}`);
}

function assertDirectoryOwner(path: string, uid: number): void {
  if (
    process.platform !== 'win32'
    && typeof process.getuid === 'function'
    && uid !== process.getuid()
  ) {
    throw new Error(
      `Refusing state directory owned by uid ${uid}: ${path}. `
      + `It must be owned by the current uid ${process.getuid()}.`,
    );
  }
}

function assertExistingDirectoryIsPrivate(path: string, mode: number): void {
  if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
    throw new Error(
      `Refusing to change permissions on existing state directory: ${path}. `
      + 'Set its permissions to 0700 explicitly before use.',
    );
  }
}

/** Create or tighten a directory that contains private application state. */
export async function ensurePrivateDirectory(path: string): Promise<void> {
  const created = await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  assertDirectory(path, stat.isSymbolicLink(), stat.isDirectory());
  assertDirectoryOwner(path, stat.uid);
  if (created === undefined) {
    assertExistingDirectoryIsPrivate(path, stat.mode);
  } else if (process.platform !== 'win32') {
    await chmod(path, 0o700);
  }
}

/**
 * Create a private child directory without changing an already-existing parent.
 *
 * Atomic writers may be given a file directly below a caller-owned directory
 * (for example the operating system's temporary directory). Tightening that
 * shared parent would be both surprising and, on hardened systems, forbidden.
 */
export async function ensurePrivateChildDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  assertDirectory(path, stat.isSymbolicLink(), stat.isDirectory());
}

/** Synchronous bootstrap counterpart for logging and process startup. */
export function ensurePrivateDirectorySync(path: string): void {
  const created = mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  assertDirectory(path, stat.isSymbolicLink(), stat.isDirectory());
  assertDirectoryOwner(path, stat.uid);
  if (created === undefined) {
    assertExistingDirectoryIsPrivate(path, stat.mode);
  } else if (process.platform !== 'win32') {
    chmodSync(path, 0o700);
  }
}
