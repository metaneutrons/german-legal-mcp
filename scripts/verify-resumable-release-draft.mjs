#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function verifyResumableReleaseDraft(release, expectedTag, expectedCommit) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    throw new Error('Existing release metadata is invalid.');
  }
  if (release.draft !== true) {
    throw new Error('Existing release is not a resumable draft.');
  }
  if (release.tag_name !== expectedTag) {
    throw new Error('Existing release draft has the wrong tag.');
  }
  if (release.target_commitish !== expectedCommit) {
    throw new Error('Existing release draft has the wrong target commit.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [metadataPath, expectedTag, expectedCommit] = process.argv.slice(2);
  if (!metadataPath || !expectedTag || !expectedCommit) {
    process.stderr.write(
      'Usage: node scripts/verify-resumable-release-draft.mjs '
      + '<metadata.json> <tag> <commit>\n',
    );
    process.exit(2);
  }
  const release = JSON.parse(await readFile(resolve(metadataPath), 'utf8'));
  verifyResumableReleaseDraft(release, expectedTag, expectedCommit);
  process.stdout.write(`Existing release draft verified: ${expectedTag}@${expectedCommit}.\n`);
}
