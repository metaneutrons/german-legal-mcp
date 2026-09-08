import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const output = resolve(dist, 'build-id.json');

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  }));
  return files.flat();
}

const files = (await collectFiles(dist))
  .filter((path) => path !== output)
  .sort((left, right) => left.localeCompare(right, 'en'));
const hash = createHash('sha256');

for (const path of files) {
  const portablePath = relative(dist, path).split(sep).join('/');
  hash.update(portablePath, 'utf8');
  hash.update('\0');
  hash.update(await readFile(path));
  hash.update('\0');
}

await writeFile(output, `${JSON.stringify({ version: 1, sha256: hash.digest('hex') })}\n`);
