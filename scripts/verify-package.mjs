#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporaryRoot = await mkdtemp(join(tmpdir(), 'glmcp-package-verify-'));

function parseArguments(arguments_) {
  if (arguments_.length === 0) return undefined;
  if (arguments_.length === 2 && arguments_[0] === '--tarball' && arguments_[1]) {
    return resolve(process.cwd(), arguments_[1]);
  }
  throw new Error('Usage: node scripts/verify-package.mjs [--tarball <package.tgz>]');
}

function run(command, args, options, label) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${label} failed with exit code ${String(result.status)}\n${detail}`);
  }
  return result.stdout;
}

function exportTargets(node) {
  if (typeof node === 'string') return [node];
  if (!node || typeof node !== 'object') return [];
  return Object.values(node).flatMap(exportTargets);
}

function requiredPackageFiles(packageJson) {
  const targets = Object.values(packageJson.exports ?? {})
    .flatMap(exportTargets)
    .filter((target) => target.startsWith('./'))
    .map((target) => target.slice(2));
  const bins = typeof packageJson.bin === 'string'
    ? [packageJson.bin]
    : Object.values(packageJson.bin ?? {});
  return [...new Set([
    ...targets,
    ...bins,
    'dist/build-id.json',
    'LICENSE',
    'README.md',
    'package.json',
  ])];
}

function inspectTarball(tarball) {
  const listing = run('tar', ['-tzf', tarball], {}, 'npm tarball inventory');
  const detailedListing = run('tar', ['-tvzf', tarball], {}, 'npm tarball type inventory');
  const unsafeTypes = detailedListing
    .split('\n')
    .filter(Boolean)
    .filter((line) => line[0] !== '-' && line[0] !== 'd');
  if (unsafeTypes.length > 0) {
    throw new Error('Package tarball contains a symbolic link or another unsupported entry type.');
  }

  const entries = listing.split('\n').filter(Boolean);
  const seen = new Set();
  const files = [];
  for (const entry of entries) {
    if (entry.includes('\\') || entry.startsWith('/') || entry.includes('\0')) {
      throw new Error(`Unsafe package tarball entry: ${entry}`);
    }
    const parts = entry.split('/');
    if (parts[0] !== 'package' || parts.some((part) => part === '..')) {
      throw new Error(`Package tarball entry escapes the package root: ${entry}`);
    }
    if (seen.has(entry)) throw new Error(`Duplicate package tarball entry: ${entry}`);
    seen.add(entry);
    if (!entry.endsWith('/')) files.push(parts.slice(1).join('/'));
  }
  return files;
}

async function loadPrivatePackagePolicy() {
  const path = join(root, 'scripts', 'package-private-policy.json');
  try {
    const policy = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(policy.forbiddenPrefixes)
      || policy.forbiddenPrefixes.some((prefix) => (
        typeof prefix !== 'string'
        || !prefix.startsWith('dist/')
        || prefix.includes('..')
      ))) {
      throw new TypeError('Invalid private package policy');
    }
    return policy.forbiddenPrefixes;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function verifyManifestContracts(packageJson) {
  for (const filename of ['manifest.json', 'manifest.private.json']) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(root, filename), 'utf8'));
    } catch (error) {
      if (filename === 'manifest.private.json' && error?.code === 'ENOENT') continue;
      throw error;
    }
    if (manifest.version !== packageJson.version) {
      throw new Error(
        `${filename} version ${String(manifest.version)} does not match package version `
        + `${String(packageJson.version)}.`,
      );
    }
    const manifestNode = manifest.compatibility?.runtimes?.node;
    const packageNode = packageJson.engines?.node;
    if (manifestNode !== packageNode) {
      throw new Error(
        `${filename} Node runtime ${String(manifestNode)} does not match package engine `
        + `${String(packageNode)}.`,
      );
    }
    const entryPoint = manifest.server?.entry_point;
    if (typeof entryPoint !== 'string' || entryPoint.length === 0) {
      throw new Error(`${filename} declares no server entry point.`);
    }
    if (
      manifest.user_config?.export_dir?.type !== 'directory'
      || manifest.server?.mcp_config?.env?.GLMCP_EXPORT_DIR !== '${user_config.export_dir}'
    ) {
      throw new Error(
        `${filename} must expose the save_path boundary as directory user_config.export_dir.`,
      );
    }
  }
}

try {
  const suppliedTarball = parseArguments(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const privateForbiddenPrefixes = await loadPrivatePackagePolicy();
  await verifyManifestContracts(packageJson);
  let tarball = suppliedTarball;
  if (tarball) {
    const metadata = await lstat(tarball);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
      throw new Error('Supplied npm tarball must be a non-empty regular, non-symlink file.');
    }
  } else {
    const packOutput = run(npm, [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      temporaryRoot,
    ], { cwd: root }, 'npm pack');

    let report;
    try {
      report = JSON.parse(packOutput)[0];
    } catch {
      throw new Error(`Could not parse npm pack output:\n${packOutput}`);
    }
    if (!report?.filename) {
      throw new Error('npm pack did not return an artifact filename.');
    }
    tarball = join(temporaryRoot, report.filename);
  }

  const files = inspectTarball(tarball);
  const forbidden = files.filter((path) => (
    path.endsWith('.test.js')
    || path.includes('/tests/')
    || path.includes('/fixtures/')
    || path.startsWith('coverage/')
    || path.startsWith('src/')
    || privateForbiddenPrefixes.some((prefix) => path.startsWith(prefix))
  ));
  const missing = requiredPackageFiles(packageJson)
    .filter((path) => !files.includes(path));
  if (forbidden.length > 0 || missing.length > 0) {
    const details = [
      ...(forbidden.length > 0
        ? [`Forbidden package artifacts:\n${forbidden.join('\n')}`]
        : []),
      ...(missing.length > 0
        ? [`Missing package artifacts:\n${missing.join('\n')}`]
        : []),
    ];
    throw new Error(details.join('\n'));
  }

  // Install the actual tarball into a clean consumer. This catches undeclared
  // runtime dependencies and export targets that a self-import from the source
  // checkout would accidentally satisfy through devDependencies or extra files.
  const consumer = join(temporaryRoot, 'consumer');
  const consumerPackagePath = join(temporaryRoot, 'consumer-package.json');
  await writeFile(consumerPackagePath, JSON.stringify({
    private: true,
    type: 'module',
  }));
  await mkdir(consumer);
  await copyFile(consumerPackagePath, join(consumer, 'package.json'));

  run(npm, [
    'install',
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    tarball,
  ], { cwd: consumer }, 'clean tarball installation');

  const specifiers = Object.keys(packageJson.exports ?? {})
    .filter((subpath) => subpath !== './package.json')
    .map((subpath) => subpath === '.' ? packageJson.name : `${packageJson.name}/${subpath.slice(2)}`);
  const verifierPath = join(consumer, 'verify-exports.mjs');
  await writeFile(verifierPath, [
    `const specifiers = ${JSON.stringify(specifiers)};`,
    'for (const specifier of specifiers) {',
    '  const loaded = await import(specifier);',
    '  if (!loaded || typeof loaded !== "object") {',
    '    throw new Error(`Export ${specifier} did not load as a module.`);',
    '  }',
    '}',
    `const contracts = await import(${JSON.stringify(`${packageJson.name}/contracts`)});`,
    'if (!contracts.LEGAL_RESOURCE_TYPES?.includes("case-law")) {',
    '  throw new Error("Contract export is not consumable.");',
    '}',
  ].join('\n'));
  const safeEnvironment = getDefaultEnvironment();
  safeEnvironment.GLMCP_LOG_LEVEL = 'error';
  run(process.execPath, [verifierPath], {
    cwd: consumer,
    env: safeEnvironment,
  }, 'clean package export import');

  const installedRoot = join(
    consumer,
    'node_modules',
    ...packageJson.name.split('/'),
  );
  const binEntry = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : Object.values(packageJson.bin ?? {})[0];
  if (!binEntry) throw new Error('Package declares no executable entry point.');
  const versionOutput = run(process.execPath, [join(installedRoot, binEntry), '--version'], {
    cwd: consumer,
    env: safeEnvironment,
  }, 'installed binary smoke test');
  if (!versionOutput.includes(packageJson.version)) {
    throw new Error(
      `Installed binary printed ${JSON.stringify(versionOutput.trim())}; `
      + `expected version ${packageJson.version}.`,
    );
  }

  process.stdout.write(
    `Package artifact verified in a clean production install (${files.length} files).\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
