#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_MAX_ATTEMPTS = 61;
const DEFAULT_RETRY_DELAY_MS = 15_000;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function packageMetadataUrl(registry, packageName, version) {
  const base = registry.endsWith('/') ? registry : `${registry}/`;
  const escapedName = packageName.replace('/', '%2f');
  return new URL(`${escapedName}/${encodeURIComponent(version)}`, base).href;
}

function requestHeaders(token) {
  return {
    accept: 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function lookupTarballUrl({ fetchImpl, packageJson, registry, token }) {
  const response = await fetchImpl(
    packageMetadataUrl(registry, packageJson.name, packageJson.version),
    { headers: requestHeaders(token) },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Published package metadata returned HTTP ${response.status}.`);
  }
  const metadata = await response.json();
  const remoteUrl = metadata?.dist?.tarball;
  if (typeof remoteUrl !== 'string') {
    throw new Error('Registry did not return a tarball URL.');
  }
  return remoteUrl;
}

// `token` authenticates the metadata lookup and the tarball download. The
// local stable publisher reads it from the Keychain and passes it here, since
// it never reaches this process's environment.
export async function verifyPublishedPackage({
  tarball,
  packageJson,
  token = process.env.NODE_AUTH_TOKEN,
  fetchImpl = fetch,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleep = delay,
  allowMissing = false,
}) {
  const registry = packageJson.publishConfig?.registry;
  if (typeof registry !== 'string' || !/^https:\/\//u.test(registry)) {
    throw new Error('Published package registry must be an HTTPS URL.');
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('Published package verification needs at least one attempt.');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remoteUrl = await lookupTarballUrl({ fetchImpl, packageJson, registry, token });
    if (remoteUrl !== undefined) {
      const response = await fetchImpl(remoteUrl, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      if (response.ok) {
        const [expected, actual] = await Promise.all([
          readFile(tarball),
          response.arrayBuffer().then((bytes) => Buffer.from(bytes)),
        ]);
        const expectedDigest = createHash('sha256').update(expected).digest('hex');
        const actualDigest = createHash('sha256').update(actual).digest('hex');
        if (expectedDigest !== actualDigest) {
          throw new Error(`Published tarball bytes differ for ${packageJson.name}@${packageJson.version}.`);
        }
        process.stdout.write(
          `Published package verified: ${packageJson.name}@${packageJson.version} (${expectedDigest}).\n`,
        );
        return true;
      }
      if (response.status !== 404) {
        throw new Error(`Published tarball download returned HTTP ${response.status}.`);
      }
    }

    if (allowMissing) return false;
    if (attempt === maxAttempts) {
      throw new Error(
        `Published package ${packageJson.name}@${packageJson.version} was not available after `
        + `${maxAttempts} attempts.`,
      );
    }
    process.stdout.write(
      `Published package not available yet (attempt ${attempt}/${maxAttempts}); retrying.\n`,
    );
    await sleep(retryDelayMs);
  }

  throw new Error('Published package verification exhausted unexpectedly.');
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const arguments_ = process.argv.slice(2);
  const allowMissing = arguments_[0] === '--if-present';
  const [tarball] = allowMissing ? arguments_.slice(1) : arguments_;
  if (!tarball) {
    process.stderr.write(
      'Usage: node scripts/verify-published-package.mjs [--if-present] <tarball>\n',
    );
    process.exit(2);
  }
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const verified = await verifyPublishedPackage({
    tarball,
    packageJson,
    allowMissing,
    maxAttempts: allowMissing ? 1 : DEFAULT_MAX_ATTEMPTS,
  });
  if (!verified) process.exitCode = 3;
}
