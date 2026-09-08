#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const artifact = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!artifact) {
  process.stderr.write('Usage: node scripts/verify-mcpb-artifact.mjs <bundle.mcpb>\n');
  process.exit(2);
}

function unzip(...args) {
  const result = spawnSync('unzip', args, {
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`unzip ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function withTimeout(promise, label, timeoutMs = 20_000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const entries = unzip('-Z1', artifact).split('\n').filter(Boolean);
const unsafeEntries = entries.filter((entry) => (
  isAbsolute(entry)
  || entry.split(/[\\/]/).includes('..')
  || entry.includes('\\')
));
if (unsafeEntries.length > 0) {
  throw new Error(`MCPB contains unsafe archive paths:\n${unsafeEntries.join('\n')}`);
}
for (const required of [
  'manifest.json',
  'package.json',
  'icon.png',
  'dist/build-id.json',
  'node_modules/@modelcontextprotocol/sdk/package.json',
]) {
  if (!entries.includes(required)) throw new Error(`MCPB is missing ${required}.`);
}
const allowedRootFiles = new Set([
  'LICENSE',
  'README.md',
  'icon.png',
  'manifest.json',
  'package.json',
]);
const unexpectedRootEntries = entries.filter((entry) => (
  !allowedRootFiles.has(entry)
  && !entry.startsWith('dist/')
  && !entry.startsWith('node_modules/')
));
const forbidden = entries.filter((entry) => (
  entry.startsWith('src/')
  || entry.startsWith('scripts/')
  || entry.startsWith('services/')
  || entry.startsWith('tests/')
  || entry.endsWith('package-lock.json')
  || entry.includes('/test/')
  || entry.includes('/tests/')
  || entry.includes('/__tests__/')
  || entry.includes('/fixture/')
  || entry.includes('/fixtures/')
  || entry.includes('/benchmark/')
  || entry.includes('/benchmarks/')
  || entry.endsWith('.test.js')
  || entry.endsWith('.test.cjs')
  || entry.endsWith('.test.mjs')
  || entry.endsWith('.test.ts')
  || entry.endsWith('.spec.js')
  || entry.endsWith('.spec.cjs')
  || entry.endsWith('.spec.mjs')
  || entry.endsWith('.spec.ts')
  || entry.endsWith('.d.cts')
  || entry.endsWith('.d.mts')
));
if (unexpectedRootEntries.length > 0 || forbidden.length > 0) {
  const format = (values) => {
    const shown = values.slice(0, 100);
    return `${shown.join('\n')}`
      + (values.length > shown.length ? `\n... and ${values.length - shown.length} more` : '');
  };
  const details = [
    ...(unexpectedRootEntries.length > 0
      ? [`Unexpected MCPB root entries:\n${format(unexpectedRootEntries)}`]
      : []),
    ...(forbidden.length > 0
      ? [`MCPB contains non-runtime files:\n${format(forbidden)}`]
      : []),
  ];
  throw new Error(details.join('\n'));
}

const extractionRoot = await mkdtemp(join(tmpdir(), 'glmcp-mcpb-verify-'));
let transport;
try {
  unzip('-qq', artifact, '-d', extractionRoot);
  const manifest = JSON.parse(await readFile(join(extractionRoot, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(join(extractionRoot, 'package.json'), 'utf8'));
  if (manifest.version !== packageJson.version) {
    throw new Error(
      `MCPB manifest version ${String(manifest.version)} does not match `
      + `package version ${String(packageJson.version)}.`,
    );
  }
  const manifestNode = manifest.compatibility?.runtimes?.node;
  const packageNode = packageJson.engines?.node;
  if (
    typeof packageNode !== 'string'
    || packageNode.length === 0
    || manifestNode !== packageNode
  ) {
    throw new Error(
      `MCPB manifest Node runtime ${String(manifestNode)} does not match `
      + `package engine ${String(packageNode)}.`,
    );
  }
  if (Object.keys(packageJson.devDependencies ?? {}).length > 0) {
    throw new Error('MCPB package.json still declares development dependencies.');
  }
  if (
    manifest.user_config?.export_dir?.type !== 'directory'
    || manifest.server?.mcp_config?.env?.GLMCP_EXPORT_DIR !== '${user_config.export_dir}'
  ) {
    throw new Error('MCPB manifest does not expose the GLMCP_EXPORT_DIR save_path boundary.');
  }
  const runtimeScripts = Object.keys(packageJson.scripts ?? {});
  if (runtimeScripts.some((name) => name !== 'start')) {
    throw new Error(`MCPB package.json contains non-runtime scripts: ${runtimeScripts.join(', ')}`);
  }
  const entryPoint = manifest.server?.entry_point;
  if (typeof entryPoint !== 'string' || !entries.includes(entryPoint)) {
    throw new Error(`MCPB manifest entry point is missing: ${String(entryPoint)}`);
  }
  const absoluteEntryPoint = join(extractionRoot, entryPoint);
  const [entryPointInfo, realExtractionRoot, realEntryPoint] = await Promise.all([
    lstat(absoluteEntryPoint),
    realpath(extractionRoot),
    realpath(absoluteEntryPoint),
  ]);
  const relativeEntryPoint = relative(realExtractionRoot, realEntryPoint);
  if (
    !entryPointInfo.isFile()
    || relativeEntryPoint === ''
    || relativeEntryPoint === '..'
    || relativeEntryPoint.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(relativeEntryPoint)
  ) {
    throw new Error(`MCPB manifest entry point is not a regular in-bundle file: ${entryPoint}`);
  }

  const version = spawnSync(process.execPath, [absoluteEntryPoint, '--version'], {
    cwd: extractionRoot,
    encoding: 'utf8',
    env: { ...getDefaultEnvironment(), GLMCP_LOG_LEVEL: 'error' },
  });
  if (version.status !== 0 || !version.stdout.includes(packageJson.version)) {
    throw new Error(
      `Packed MCPB version smoke failed:\n${version.stdout}${version.stderr}`,
    );
  }

  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    throw new Error('MCPB manifest has no declared tools.');
  }
  const providers = new Set(
    manifest.tools.map(({ name }) => String(name).split('_', 1)[0]),
  );
  const providerEnvironment = {};
  for (const provider of providers) {
    const prefix = provider.toUpperCase().replaceAll('-', '_');
    providerEnvironment[`GLMCP_${prefix}_ENABLED`] = 'true';
    providerEnvironment[`GLMCP_${prefix}_CACHE`] = 'memory';
    // Credentialed providers must be constructible for the offline startup
    // probe without baking provider identities or real secrets into this
    // public-safe verifier. Providers that do not consume these values ignore
    // them.
    providerEnvironment[`GLMCP_${prefix}_USERNAME`] = 'artifact-verifier';
    providerEnvironment[`GLMCP_${prefix}_PASSWORD`] = 'artifact-verifier';
    providerEnvironment[`GLMCP_${prefix}_LOGIN_URL`] = '';
    providerEnvironment[`GLMCP_${prefix}_TENANT_ID`] = 'artifact-verifier';
    providerEnvironment[`GLMCP_${prefix}_TENANT_KEY`] = 'artifact-verifier';
  }
  const stateDir = join(extractionRoot, '.verification-state');
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [absoluteEntryPoint],
    cwd: extractionRoot,
    env: {
      ...getDefaultEnvironment(),
      ...providerEnvironment,
      GLMCP_STATE_DIR: stateDir,
      GLMCP_LOG_LEVEL: 'error',
    },
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'german-legal-mcp-artifact-verifier', version: '1.0.0' },
    { capabilities: {} },
  );
  await withTimeout(client.connect(transport), 'packed MCPB startup');
  const runtimeTools = [];
  let cursor;
  do {
    const page = await withTimeout(
      client.listTools(cursor === undefined ? undefined : { cursor }),
      'packed MCPB tools/list',
    );
    runtimeTools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  const declaredNames = manifest.tools.map(({ name }) => name).sort();
  const runtimeNames = runtimeTools.map(({ name }) => name).sort();
  if (JSON.stringify(declaredNames) !== JSON.stringify(runtimeNames)) {
    throw new Error(
      'Packed MCPB tools/list differs from manifest.\n'
      + `Declared: ${declaredNames.join(', ')}\n`
      + `Runtime: ${runtimeNames.join(', ')}`,
    );
  }
  const runtimeByName = new Map(runtimeTools.map((tool) => [tool.name, tool]));
  const metadataDrift = manifest.tools.flatMap((declaredTool) => {
    const runtimeTool = runtimeByName.get(declaredTool.name);
    if (!runtimeTool) return [];
    const declaredDescription = declaredTool.description ?? undefined;
    const runtimeDescription = runtimeTool.description ?? undefined;
    return declaredDescription === runtimeDescription
      ? []
      : [{
        name: declaredTool.name,
        declared: declaredDescription,
        runtime: runtimeDescription,
      }];
  });
  if (metadataDrift.length > 0) {
    throw new Error(
      'Packed MCPB tool descriptions differ from runtime tools/list.\n'
      + JSON.stringify(metadataDrift, null, 2),
    );
  }

  process.stdout.write(
    `Packed MCPB verified (${basename(artifact)}, ${entries.length} files, `
    + `${runtimeNames.length} tools).\n`,
  );
} finally {
  await transport?.close().catch(() => undefined);
  await rm(extractionRoot, { recursive: true, force: true });
}
