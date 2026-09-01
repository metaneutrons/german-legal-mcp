#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECKSUMS_FILENAME,
  releaseCandidatePolicy,
} from './release-candidate-policy.mjs';
import { verifyReleaseProvenance } from './release-provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sameMembers(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export async function verifyReleaseCandidate(
  directory,
  tag,
  npmTarball,
  workspaceRoot = root,
  flavor = 'private',
  expectedInvocation = undefined,
) {
  const packageJson = JSON.parse(await readFile(resolve(workspaceRoot, 'package.json'), 'utf8'));
  const policy = releaseCandidatePolicy(packageJson, tag, flavor);
  if (npmTarball !== policy.npmTarball || basename(npmTarball) !== npmTarball) {
    throw new Error(
      `Candidate npm tarball ${String(npmTarball)} does not match ${policy.npmTarball}.`,
    );
  }
  const expectedFiles = [...policy.candidateFiles].sort();
  const candidateRoot = resolve(directory);
  const entries = await readdir(candidateRoot);
  const actualFiles = [...entries].sort();
  if (!sameMembers(actualFiles, expectedFiles)) {
    const missing = expectedFiles.filter((name) => !actualFiles.includes(name));
    const unexpected = actualFiles.filter((name) => !expectedFiles.includes(name));
    throw new Error([
      `Release candidate must contain exactly the ${expectedFiles.length} reviewed files.`,
      ...(missing.length > 0 ? [`Missing: ${missing.join(', ')}`] : []),
      ...(unexpected.length > 0 ? [`Unexpected: ${unexpected.join(', ')}`] : []),
    ].join('\n'));
  }

  for (const name of expectedFiles) {
    const metadata = await lstat(resolve(candidateRoot, name));
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Release candidate entry ${name} must be a regular, non-symlink file.`);
    }
  }

  await verifyReleaseProvenance(
    candidateRoot,
    packageJson,
    tag,
    flavor,
    expectedInvocation,
  );

  const checksumEntries = (await readFile(resolve(candidateRoot, CHECKSUMS_FILENAME), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-9a-f]{64}) [ *]([^/\\]+)$/.exec(line);
      if (!match) throw new Error(`Invalid SHA256SUMS entry: ${line}`);
      return { digest: match[1], name: match[2] };
    })
  const checksumTargets = checksumEntries
    .map(({ name }) => name)
    .sort();
  const expectedChecksumTargets = [...policy.integrityPayloads].sort();
  if (!sameMembers(checksumTargets, expectedChecksumTargets)) {
    throw new Error(
      `SHA256SUMS must name each of the ${policy.integrityPayloads.length} payload files exactly once.`,
    );
  }
  await Promise.all(checksumEntries.map(async ({ digest, name }) => {
    const actual = createHash('sha256')
      .update(await readFile(resolve(candidateRoot, name)))
      .digest('hex');
    if (actual !== digest) throw new Error(`SHA256SUMS digest mismatch: ${name}`);
  }));

  process.stdout.write(`Release candidate verified (${expectedFiles.length} exact files).\n`);
  return expectedFiles;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flavorIndex = args.indexOf('--flavor');
  const flavor = flavorIndex === -1 ? 'private' : args[flavorIndex + 1];
  if (flavorIndex !== -1) args.splice(flavorIndex, 2);
  const [directory, tag, npmTarball, ...extra] = args;
  if (!directory || !tag || !npmTarball || extra.length > 0 || !['private', 'public'].includes(flavor)) {
    process.stderr.write(
      'Usage: node scripts/verify-release-candidate.mjs '
      + '[--flavor private|public] <directory> <tag> <npm-tarball>\n',
    );
    process.exit(2);
  }
  await verifyReleaseCandidate(directory, tag, npmTarball, root, flavor);
}
