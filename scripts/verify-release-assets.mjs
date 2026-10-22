#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout || ''}`);
  }
}

async function regularFiles(directory) {
  const names = (await readdir(directory)).sort();
  await Promise.all(names.map(async (name) => {
    const metadata = await lstat(resolve(directory, name));
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Release asset is not a regular file: ${name}`);
    }
  }));
  return names;
}

export async function verifyReleaseAssets(tag, candidateDirectory, repository, cwd = process.cwd()) {
  const candidate = resolve(candidateDirectory);
  const temporaryRoot = await mkdtemp(`${tmpdir()}/glmcp-release-assets-`);
  try {
    run('gh', [
      'release', 'download', tag,
      '--repo', repository,
      '--dir', temporaryRoot,
    ], cwd);
    const [expected, actual] = await Promise.all([
      regularFiles(candidate),
      regularFiles(temporaryRoot),
    ]);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error(`Release ${tag} assets differ from the reviewed candidate.`);
    }
    await Promise.all(expected.map(async (name) => {
      const [expectedBytes, actualBytes] = await Promise.all([
        readFile(resolve(candidate, name)),
        readFile(resolve(temporaryRoot, name)),
      ]);
      const expectedDigest = createHash('sha256').update(expectedBytes).digest('hex');
      const actualDigest = createHash('sha256').update(actualBytes).digest('hex');
      if (expectedDigest !== actualDigest) {
        throw new Error(`Release asset bytes differ after upload: ${name}`);
      }
    }));
    process.stdout.write(`Release ${tag} assets verified (${expected.length} exact files).\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [tag, candidateDirectory, repository = process.env.GITHUB_REPOSITORY] = process.argv.slice(2);
  if (!tag || !candidateDirectory || !repository) {
    process.stderr.write('Usage: node scripts/verify-release-assets.mjs <tag> <candidate-dir> <owner/repo>\n');
    process.exit(2);
  }
  await verifyReleaseAssets(tag, candidateDirectory, repository);
}
