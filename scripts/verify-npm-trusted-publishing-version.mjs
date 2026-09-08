#!/usr/bin/env node
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const minimumTrustedPublishingVersion = Object.freeze([11, 5, 1]);

export function verifyNpmTrustedPublishingVersion(rawVersion) {
  const version = typeof rawVersion === 'string' ? rawVersion.trim() : '';
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) {
    throw new Error(`Invalid npm CLI version: ${version || '<missing>'}.`);
  }

  const current = match.slice(1).map(Number);
  const firstDifference = current.findIndex(
    (part, index) => part !== minimumTrustedPublishingVersion[index],
  );
  const supported = firstDifference === -1
    || current[firstDifference] > minimumTrustedPublishingVersion[firstDifference];

  if (!supported) {
    throw new Error(
      `npm ${version} lacks trusted publishing support; require npm `
      + `${minimumTrustedPublishingVersion.join('.')} or later.`,
    );
  }
  return version;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [version, ...extra] = process.argv.slice(2);
  if (!version || extra.length > 0) {
    process.stderr.write(
      'Usage: node scripts/verify-npm-trusted-publishing-version.mjs <npm-version>\n',
    );
    process.exit(2);
  }
  const verified = verifyNpmTrustedPublishingVersion(version);
  process.stdout.write(`npm trusted publishing version verified: ${verified}\n`);
}
