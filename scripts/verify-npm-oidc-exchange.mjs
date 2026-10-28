#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Preflight for npm trusted publishing: performs the same OIDC token exchange
// as npm/cli lib/utils/oidc.js (v11.19.0) before any release state exists.
// npm itself reports a failed exchange only in its verbose log and then
// falls back to the placeholder token from actions/setup-node, which ends in
// an unexplained E404 on PUT. Only HTTP status and the registry's error
// message are printed; the ID token and the npm token never leave this
// process and the npm token is discarded.

const MAX_MESSAGE_LENGTH = 300;

export function escapedPackageName(name) {
  if (typeof name !== 'string' || !/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name)) {
    throw new Error(`Invalid npm package name: ${String(name)}.`);
  }
  // npm-package-arg's escapedName: the scope separator becomes %2f.
  return name.replace('/', '%2f');
}

function safeMessage(body) {
  const message = typeof body?.message === 'string' ? body.message : '';
  // eslint-disable-next-line no-control-regex
  const printable = message.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
  return printable.slice(0, MAX_MESSAGE_LENGTH) || 'no error message';
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function verifyNpmOidcExchange({
  packageName,
  registry,
  env = process.env,
  fetchImpl = fetch,
}) {
  const registryUrl = new URL(registry);
  if (registryUrl.protocol !== 'https:') {
    throw new Error('The npm registry must be an HTTPS URL.');
  }
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error(
      'npm OIDC preflight needs a GitHub Actions job with `permissions: id-token: write`.',
    );
  }

  const idTokenUrl = new URL(requestUrl);
  idTokenUrl.searchParams.append('audience', `npm:${registryUrl.hostname}`);
  const idTokenResponse = await fetchImpl(idTokenUrl.href, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${requestToken}` },
  });
  const idTokenBody = await readJson(idTokenResponse);
  if (!idTokenResponse.ok || typeof idTokenBody?.value !== 'string' || !idTokenBody.value) {
    throw new Error(
      `GitHub did not issue an OIDC ID token (HTTP ${idTokenResponse.status}).`,
    );
  }

  const exchangeUrl = new URL(
    `/-/npm/v1/oidc/token/exchange/package/${escapedPackageName(packageName)}`,
    registryUrl,
  );
  const exchangeResponse = await fetchImpl(exchangeUrl.href, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${idTokenBody.value}` },
  });
  const exchangeBody = await readJson(exchangeResponse);
  if (!exchangeResponse.ok || typeof exchangeBody?.token !== 'string' || !exchangeBody.token) {
    throw new Error(
      `npm OIDC token exchange for ${packageName} failed with HTTP `
      + `${exchangeResponse.status}: ${safeMessage(exchangeBody)}`,
    );
  }
  return { status: exchangeResponse.status };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    process.stderr.write('Usage: node scripts/verify-npm-oidc-exchange.mjs\n');
    process.exit(2);
  }
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const registry = packageJson.publishConfig?.registry;
  if (typeof registry !== 'string') {
    throw new Error('package.json must declare publishConfig.registry.');
  }
  const { status } = await verifyNpmOidcExchange({ packageName: packageJson.name, registry });
  process.stdout.write(
    `npm OIDC token exchange for ${packageJson.name} succeeded (HTTP ${status}).\n`,
  );
}
