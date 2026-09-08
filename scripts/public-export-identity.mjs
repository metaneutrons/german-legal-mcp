import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export const PUBLIC_EXPORT_IDENTITY = '.public-export.json';
const EXCLUDED_ROOTS = new Set(['.git', '.github', PUBLIC_EXPORT_IDENTITY]);

export async function digestPublicTree(directory) {
  const root = resolve(directory);
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (current === root && EXCLUDED_ROOTS.has(entry.name)) continue;
      const path = join(current, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Public tree contains symbolic link: ${relative(root, path)}`);
      }
      if (metadata.isDirectory()) await walk(path);
      else if (metadata.isFile() && metadata.nlink === 1) files.push(path);
      else throw new Error(`Public tree contains unsupported entry: ${relative(root, path)}`);
    }
  }
  await walk(root);
  const hash = createHash('sha256');
  for (const path of files.sort((a, b) => a.localeCompare(b))) {
    const name = relative(root, path).split(sep).join('/');
    const content = await readFile(path);
    hash.update(name);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return { fileCount: files.length, sha256: hash.digest('hex') };
}
