#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function requireEqual(actual, expected, location) {
  if (actual !== expected) {
    throw new Error(`${location} version ${String(actual)} does not match package.json ${expected}.`);
  }
}

function requireSingleTag(source, expression, expected, location) {
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1 || matches[0][1] !== expected) {
    throw new Error(
      `${location} must project package.json's stable core exactly once as ${expected}; `
      + `found ${matches.map((match) => match[1]).join(', ') || 'nothing'}.`,
    );
  }
}

async function isRegularFile(path) {
  try {
    return (await lstat(path)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function requirePublicVersionProjections(packageJson, packageLock, publicManifest) {
  const version = packageJson.version;
  if (typeof version !== 'string' || !semverPattern.test(version)) {
    throw new Error(`package.json version ${String(version)} is not valid semantic versioning.`);
  }
  requireEqual(packageLock.version, version, 'package-lock.json');
  requireEqual(packageLock.packages?.['']?.version, version, 'package-lock.json packages[""]');
  requireEqual(publicManifest.version, version, 'manifest.json');
  if (packageLock.name !== packageJson.name || packageLock.packages?.['']?.name !== packageJson.name) {
    throw new Error('package-lock.json root package identity does not match package.json.');
  }
  return { stableCore: version.split('-', 1)[0].split('+', 1)[0], version };
}

function privateVersionPaths(resolvedRoot) {
  return [
    resolve(resolvedRoot, 'manifest.private.json'),
    resolve(resolvedRoot, 'services/private-cache/docker-compose.yml'),
    resolve(resolvedRoot, 'services/private-cache/postgres/Dockerfile'),
    resolve(resolvedRoot, 'services/private-cache/sync/Dockerfile'),
  ];
}

function requireCompletePrivateTree(presence) {
  if (presence.some(Boolean) && !presence.every(Boolean)) {
    throw new Error('Private version projections are incomplete; refusing a mixed public/private tree.');
  }
  return presence.every(Boolean);
}

function requirePrivateImageProjections(compose, postgres, sync, stableCore) {
  requireSingleTag(
    compose,
    /^\s*image:\s*german-legal-mcp-private-cache-postgres:([^\s]+)\s*$/gm,
    stableCore,
    'PostgreSQL Compose image',
  );
  requireSingleTag(
    compose,
    /^\s*image:\s*german-legal-mcp-private-cache-sync:([^\s]+)\s*$/gm,
    stableCore,
    'sync Compose image',
  );
  requireSingleTag(
    postgres,
    /org\.opencontainers\.image\.version="([^"]+)"/g,
    stableCore,
    'PostgreSQL OCI label',
  );
  requireSingleTag(
    sync,
    /org\.opencontainers\.image\.version="([^"]+)"/g,
    stableCore,
    'sync OCI label',
  );
}

async function verifyPrivateVersionProjections(resolvedRoot, version, stableCore) {
  const paths = privateVersionPaths(resolvedRoot);
  if (!requireCompletePrivateTree(await Promise.all(paths.map(isRegularFile)))) return;
  const [privateManifest, compose, postgres, sync] = await Promise.all([
    readJson(paths[0]),
    readFile(paths[1], 'utf8'),
    readFile(paths[2], 'utf8'),
    readFile(paths[3], 'utf8'),
  ]);
  requireEqual(privateManifest.version, version, 'manifest.private.json');
  requirePrivateImageProjections(compose, postgres, sync, stableCore);
}

/** Verify every shipped version projection against package.json, the sole SSOT. */
export async function verifyVersionSsot(workspaceRoot = root) {
  const resolvedRoot = resolve(workspaceRoot);
  const [packageJson, packageLock, publicManifest] = await Promise.all([
    readJson(resolve(resolvedRoot, 'package.json')),
    readJson(resolve(resolvedRoot, 'package-lock.json')),
    readJson(resolve(resolvedRoot, 'manifest.json')),
  ]);
  const { version, stableCore } = requirePublicVersionProjections(
    packageJson,
    packageLock,
    publicManifest,
  );
  await verifyPrivateVersionProjections(resolvedRoot, version, stableCore);

  process.stdout.write(`Version SSOT verified: ${version} (service core ${stableCore}).\n`);
  return { version, stableCore };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyVersionSsot();
}
