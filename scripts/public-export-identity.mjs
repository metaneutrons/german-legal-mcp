import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export const PUBLIC_EXPORT_IDENTITY = '.public-export.json';
const EXCLUDED_ROOTS = new Set(['.git', '.github', PUBLIC_EXPORT_IDENTITY]);

/**
 * Root files whose only release-bound content is their top-level `version`.
 * Every release bumps it, so a comparison of public content ignores it.
 */
export const VERSIONED_ROOT_FILES = new Set(['package.json', 'manifest.json']);

async function publicFiles(directory) {
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
  return files
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, name: relative(root, path).split(sep).join('/') }));
}

function updateEntry(hash, name, content) {
  hash.update(name);
  hash.update('\0');
  hash.update(String(content.length));
  hash.update('\0');
  hash.update(content);
  hash.update('\0');
}

export async function digestPublicTree(directory) {
  const files = await publicFiles(directory);
  const hash = createHash('sha256');
  for (const { path, name } of files) updateEntry(hash, name, await readFile(path));
  return { fileCount: files.length, sha256: hash.digest('hex') };
}

/** File content as compared across releases: versioned root files without their version. */
async function releaseNeutralContent(path, name) {
  const content = await readFile(path);
  if (!VERSIONED_ROOT_FILES.has(name)) return content;
  const parsed = JSON.parse(content.toString('utf8'));
  if (parsed !== null && typeof parsed === 'object' && 'version' in parsed) {
    parsed.version = '<release-version>';
  }
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
}

/**
 * Per-file digests of the public content, with the release version and the
 * export identity file left out. Two trees with equal maps differ only in what
 * every release changes anyway.
 */
export async function digestPublicContent(directory) {
  const digests = new Map();
  for (const { path, name } of await publicFiles(directory)) {
    const content = await releaseNeutralContent(path, name);
    digests.set(name, createHash('sha256').update(content).digest('hex'));
  }
  return digests;
}

/** File names added, removed or changed between two public trees, ignoring the release version. */
export async function changedPublicFiles(baselineDirectory, candidateDirectory) {
  const [baseline, candidate] = await Promise.all([
    digestPublicContent(baselineDirectory),
    digestPublicContent(candidateDirectory),
  ]);
  const names = new Set([...baseline.keys(), ...candidate.keys()]);
  return [...names]
    .filter((name) => baseline.get(name) !== candidate.get(name))
    .sort((a, b) => a.localeCompare(b));
}
