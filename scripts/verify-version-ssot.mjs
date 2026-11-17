#!/usr/bin/env node
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function requireEqual(actual, expected, location, source = 'package.json') {
  if (actual !== expected) {
    throw new Error(`${location} version ${String(actual)} does not match ${source} ${expected}.`);
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

function requirePublicVersionProjections(packageJson, publicManifest) {
  const version = packageJson.version;
  if (typeof version !== 'string' || !semverPattern.test(version)) {
    throw new Error(`package.json version ${String(version)} is not valid semantic versioning.`);
  }
  requireEqual(publicManifest.version, version, 'manifest.json');
  return { stableCore: version.split('-', 1)[0].split('+', 1)[0], version };
}

function privateCacheVersionPaths(resolvedRoot) {
  return [
    resolve(resolvedRoot, 'services/private-cache/version.json'),
    resolve(resolvedRoot, 'services/private-cache/docker-compose.yml'),
    resolve(resolvedRoot, 'services/private-cache/postgres/Dockerfile'),
    resolve(resolvedRoot, 'services/private-cache/sync/Dockerfile'),
    resolve(resolvedRoot, 'services/private-cache/admin/Dockerfile'),
    resolve(resolvedRoot, 'services/private-cache/sync/package.json'),
    resolve(resolvedRoot, 'services/private-cache/admin/package.json'),
  ];
}

function requireCompletePrivateCacheTree(presence) {
  if (presence.some(Boolean) && !presence.every(Boolean)) {
    throw new Error('Private-cache version projections are incomplete; refusing a partial service tree.');
  }
  return presence.every(Boolean);
}

function requirePrivateImageProjections(compose, postgres, sync, admin, stableCore) {
  requireSingleTag(
    compose,
    /^\s*image:\s*\$\{GLMCP_CACHE_POSTGRES_IMAGE:-german-legal-mcp-private-cache-postgres:([^\s}]+)\}\s*$/gm,
    stableCore,
    'PostgreSQL Compose image',
  );
  requireSingleTag(
    compose,
    /^\s*image:\s*\$\{GLMCP_CACHE_SYNC_IMAGE:-german-legal-mcp-private-cache-sync:([^\s}]+)\}\s*$/gm,
    stableCore,
    'sync Compose image',
  );
  requireSingleTag(
    compose,
    /^\s*image:\s*\$\{GLMCP_CACHE_ADMIN_IMAGE:-german-legal-mcp-private-cache-admin:([^\s}]+)\}\s*$/gm,
    stableCore,
    'admin Compose image',
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
  requireSingleTag(
    admin,
    /org\.opencontainers\.image\.version="([^"]+)"/g,
    stableCore,
    'admin OCI label',
  );
}

async function verifyPrivateManifestProjection(resolvedRoot, version) {
  const path = resolve(resolvedRoot, 'manifest.private.json');
  if (!await isRegularFile(path)) return;
  requireEqual((await readJson(path)).version, version, 'manifest.private.json');
}

async function requireSchemaProjection(resolvedRoot, expected) {
  if (!Number.isSafeInteger(expected) || expected < 1) {
    throw new Error(`services/private-cache/version.json schema ${String(expected)} is invalid.`);
  }
  const names = await readdir(resolve(resolvedRoot, 'services/private-cache/postgres/migrations'));
  const migrations = names.flatMap((name) => {
    const match = /^(\d{3})-[a-z0-9-]+[.]sql$/u.exec(name);
    return match ? [Number(match[1])] : [];
  });
  const latest = Math.max(0, ...migrations);
  if (latest !== expected) {
    throw new Error(`Cache schema ${expected} does not match latest migration ${latest}.`);
  }
}

async function verifyPrivateCacheVersionProjections(resolvedRoot) {
  const paths = privateCacheVersionPaths(resolvedRoot);
  if (!requireCompletePrivateCacheTree(await Promise.all(paths.map(isRegularFile)))) return null;
  const [cacheMetadata, compose, postgres, sync, admin, syncPackage, adminPackage] = await Promise.all([
    readJson(paths[0]),
    readFile(paths[1], 'utf8'),
    readFile(paths[2], 'utf8'),
    readFile(paths[3], 'utf8'),
    readFile(paths[4], 'utf8'),
    readJson(paths[5]),
    readJson(paths[6]),
  ]);
  const cacheVersion = cacheMetadata.version;
  if (typeof cacheVersion !== 'string' || !semverPattern.test(cacheVersion)
    || cacheVersion.includes('-') || cacheVersion.includes('+')) {
    throw new Error(`services/private-cache/version.json version ${String(cacheVersion)} is not stable semantic versioning.`);
  }
  requireEqual(syncPackage.version, cacheVersion, 'sync package.json', 'cache version');
  requireEqual(adminPackage.version, cacheVersion, 'admin package.json', 'cache version');
  requirePrivateImageProjections(compose, postgres, sync, admin, cacheVersion);
  await requireSchemaProjection(resolvedRoot, cacheMetadata.schema);
  return { cacheSchema: cacheMetadata.schema, cacheVersion };
}

/** Verify MCP projections and the independently versioned private-cache stack. */
export async function verifyVersionSsot(workspaceRoot = root) {
  const resolvedRoot = resolve(workspaceRoot);
  const [packageJson, publicManifest] = await Promise.all([
    readJson(resolve(resolvedRoot, 'package.json')),
    readJson(resolve(resolvedRoot, 'manifest.json')),
  ]);
  const { version, stableCore } = requirePublicVersionProjections(
    packageJson,
    publicManifest,
  );
  await verifyPrivateManifestProjection(resolvedRoot, version);
  const cache = await verifyPrivateCacheVersionProjections(resolvedRoot);

  process.stdout.write(cache
    ? `Version SSOT verified: MCP ${version}; cache ${cache.cacheVersion}; schema ${cache.cacheSchema}.\n`
    : `Version SSOT verified: MCP ${version}.\n`);
  return { version, stableCore, ...(cache ?? {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyVersionSsot();
}
