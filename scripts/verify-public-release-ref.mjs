#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

const [tag, ...extra] = process.argv.slice(2);
if (!tag || extra.length > 0) {
  process.stderr.write('Usage: node scripts/verify-public-release-ref.mjs <vX.Y.Z>\n');
  process.exit(2);
}
const [packageJson, manifest] = await Promise.all([
  readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'manifest.json'), 'utf8').then(JSON.parse),
]);
if (tag !== `v${packageJson.version}` || manifest.version !== packageJson.version) {
  throw new Error('Public release tag, package and MCPB manifest versions differ.');
}
if (
  packageJson.repository?.url
    !== 'git+https://github.com/metaneutrons/german-legal-mcp.git'
  || packageJson.publishConfig?.registry !== 'https://registry.npmjs.org'
) throw new Error('Public release identity does not name the canonical source and registry.');

const tagCommit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
const head = git('rev-parse', '--verify', 'HEAD^{commit}');
if (tagCommit !== head) throw new Error(`Public release tag ${tag} does not resolve to HEAD.`);
git(
  '-c',
  `gpg.ssh.allowedSignersFile=${resolve(root, 'scripts/release-allowed-signers')}`,
  'verify-tag',
  tag,
);
const main = git('rev-parse', '--verify', 'refs/remotes/origin/main^{commit}');
git('merge-base', '--is-ancestor', head, main);
process.stdout.write(`Public release ref verified: ${tag} -> ${head}\n`);
