#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  greatestStableReleaseTag,
  parseStableVersion,
  requireStrictlyNewerStableVersion,
} from './release-version-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2];
if (!tag) {
  process.stderr.write(
    'Usage: node scripts/verify-release-destinations.mjs <v-prefixed-tag>\n',
  );
  process.exit(2);
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
parseStableVersion(packageJson.version, 'package.json version');
const expectedTag = `v${packageJson.version}`;
if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package version ${expectedTag}.`);
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
}

const registry = packageJson.publishConfig?.registry;
if (typeof registry !== 'string' || registry.length === 0) {
  throw new Error('package.json must declare publishConfig.registry.');
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageIdentity = `${packageJson.name}@${packageJson.version}`;

const latestPackageLookup = run(npm, [
  'view',
  `${packageJson.name}@latest`,
  'version',
  '--json',
  '--registry',
  registry,
]);
const latestPackageDetail = `${latestPackageLookup.stdout}${latestPackageLookup.stderr}`;
if (latestPackageLookup.status === 0) {
  let latestPackageVersion;
  try {
    latestPackageVersion = JSON.parse(latestPackageLookup.stdout);
  } catch {
    throw new Error(`Registry returned invalid latest-version JSON:\n${latestPackageDetail}`);
  }
  if (typeof latestPackageVersion !== 'string') {
    throw new Error(`Registry returned an invalid latest package version:\n${latestPackageDetail}`);
  }
  parseStableVersion(latestPackageVersion, 'registry latest version');
  requireStrictlyNewerStableVersion(
    packageJson.version,
    latestPackageVersion,
    `${registry} latest`,
  );
} else if (!/\bE404\b/.test(latestPackageDetail)) {
  throw new Error(
    `Registry latest-version check failed for ${packageJson.name}:\n${latestPackageDetail}`,
  );
}

const packageLookup = run(npm, [
  'view',
  packageIdentity,
  'version',
  '--json',
  '--registry',
  registry,
]);
const packageDetail = `${packageLookup.stdout}${packageLookup.stderr}`;
if (packageLookup.status === 0) {
  throw new Error(`Package ${packageIdentity} already exists and cannot be replaced.`);
}
if (!/\bE404\b/.test(packageDetail)) {
  throw new Error(
    `Registry availability check failed for ${packageIdentity}:\n${packageDetail}`,
  );
}

const repository = process.env.GITHUB_REPOSITORY;
if (!repository) {
  throw new Error('GITHUB_REPOSITORY is required to check the release destination.');
}

const releasesLookup = run('gh', [
  'api',
  '--paginate',
  `repos/${repository}/releases?per_page=100`,
  '--jq',
  '.[] | select(.draft == false and .prerelease == false) | .tag_name',
]);
if (releasesLookup.status !== 0) {
  throw new Error(
    `GitHub stable-release history check failed for ${repository}:\n`
    + `${releasesLookup.stdout}${releasesLookup.stderr}`,
  );
}
const greatestRelease = greatestStableReleaseTag(
  releasesLookup.stdout.split('\n').filter(Boolean),
);
if (greatestRelease !== undefined) {
  requireStrictlyNewerStableVersion(
    packageJson.version,
    greatestRelease,
    `${repository} greatest stable release`,
  );
}

const releaseLookup = run('gh', [
  'api',
  `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
  '--silent',
]);
const releaseDetail = `${releaseLookup.stdout}${releaseLookup.stderr}`;
if (releaseLookup.status === 0) {
  throw new Error(`GitHub release ${repository}@${tag} already exists and cannot be replaced.`);
}
if (!/HTTP 404\b/.test(releaseDetail)) {
  throw new Error(
    `GitHub release availability check failed for ${repository}@${tag}:\n${releaseDetail}`,
  );
}

process.stdout.write(
  `Release destinations are available: ${packageIdentity}, ${repository}@${tag}\n`,
);
