#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function view(args, cwd, token) {
  const result = spawnSync('pnpm', ['view', ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    env: token ? { ...process.env, NODE_AUTH_TOKEN: token } : process.env,
  });
  if (result.status !== 0) throw new Error(`pnpm view failed:\n${result.stderr || result.stdout || ''}`);
  return JSON.parse(result.stdout);
}

// `token` authenticates the metadata lookup and the tarball download. The
// local stable publisher reads it from the Keychain and passes it here, since
// it never reaches this process's environment.
export async function verifyPublishedPackage({
  tarball,
  packageJson,
  cwd = process.cwd(),
  token = process.env.NODE_AUTH_TOKEN,
}) {
  const registry = packageJson.publishConfig?.registry;
  if (typeof registry !== 'string' || !/^https:\/\//u.test(registry)) {
    throw new Error('Published package registry must be an HTTPS URL.');
  }
  const metadata = view([
    `${packageJson.name}@${packageJson.version}`,
    'dist.tarball',
    '--registry',
    registry,
  ], cwd, token);
  const remoteUrl = typeof metadata === 'string' ? metadata : metadata?.dist?.tarball;
  if (typeof remoteUrl !== 'string') throw new Error('Registry did not return a tarball URL.');
  const response = await fetch(remoteUrl, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`Published tarball download returned HTTP ${response.status}.`);
  const [expected, actual] = await Promise.all([
    readFile(tarball),
    response.arrayBuffer().then((bytes) => Buffer.from(bytes)),
  ]);
  const expectedDigest = createHash('sha256').update(expected).digest('hex');
  const actualDigest = createHash('sha256').update(actual).digest('hex');
  if (expectedDigest !== actualDigest) {
    throw new Error(`Published tarball bytes differ for ${packageJson.name}@${packageJson.version}.`);
  }
  process.stdout.write(`Published package verified: ${packageJson.name}@${packageJson.version} (${expectedDigest}).\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [tarball] = process.argv.slice(2);
  if (!tarball) {
    process.stderr.write('Usage: node scripts/verify-published-package.mjs <tarball>\n');
    process.exit(2);
  }
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  await verifyPublishedPackage({ tarball, packageJson });
}
