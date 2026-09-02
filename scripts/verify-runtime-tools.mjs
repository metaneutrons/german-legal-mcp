#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST_TIMEOUT_MS = 15_000;
const writeGeneratedTools = process.argv.includes('--write');

async function readManifest(name) {
  try {
    return JSON.parse(await readFile(resolve(root, name), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function runtimeEnvironment(manifest, stateDir) {
  const providers = new Set(manifest.tools.map(({ name }) => name.split('_', 1)[0]));
  const declaredEnvironment = manifest.server?.mcp_config?.env ?? {};
  const providerEnvironment = {};
  for (const provider of providers) {
    const envPrefix = provider.toUpperCase().replaceAll('-', '_');
    providerEnvironment[`GLMCP_${envPrefix}_ENABLED`] = 'true';
    providerEnvironment[`GLMCP_${envPrefix}_CACHE`] = 'memory';
    for (const suffix of ['USERNAME', 'PASSWORD', 'ENTITLEMENT_ID']) {
      const key = `GLMCP_${envPrefix}_${suffix}`;
      if (Object.hasOwn(declaredEnvironment, key)) {
        providerEnvironment[key] = 'runtime-tool-verifier';
      }
    }
    const loginUrl = `GLMCP_${envPrefix}_LOGIN_URL`;
    if (Object.hasOwn(declaredEnvironment, loginUrl)) providerEnvironment[loginUrl] = '';
  }

  return {
    ...getDefaultEnvironment(),
    GLMCP_STATE_DIR: stateDir,
    GLMCP_LOG_LEVEL: 'error',
    // Make every provider declared by this manifest deterministic rather than
    // depending on local credentials. Registration performs no upstream tool
    // request; memory cache overrides keep initialization inside this process
    // and the temporary state directory.
    ...providerEnvironment,
  };
}

async function listRuntimeTools(manifestName, manifest) {
  const entryPoint = manifest.server?.entry_point;
  if (typeof entryPoint !== 'string' || entryPoint.length === 0) {
    throw new Error(`${manifestName} has no server.entry_point.`);
  }

  const stateDir = await mkdtemp(resolve(tmpdir(), 'glmcp-runtime-tools-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(root, entryPoint)],
    cwd: root,
    env: runtimeEnvironment(manifest, stateDir),
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'german-legal-mcp-runtime-tool-verifier', version: '1.0.0' },
    { capabilities: {} },
  );
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await withTimeout(client.connect(transport), `${manifestName} MCP startup`);
    const tools = [];
    let cursor;
    do {
      const page = await withTimeout(
        client.listTools(cursor === undefined ? undefined : { cursor }),
        `${manifestName} tools/list`,
      );
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools;
  } catch (error) {
    const detail = stderr.trim();
    throw new Error(
      `${manifestName} runtime tools/list failed: ${error instanceof Error ? error.message : String(error)}`
      + (detail ? `\nServer stderr:\n${detail}` : ''),
      { cause: error },
    );
  } finally {
    await transport.close().catch(() => undefined);
    await rm(stateDir, { recursive: true, force: true });
  }
}

function compareToolContract(manifestName, declaredTools, runtimeTools) {
  const declared = declaredTools.map(({ name }) => name);
  const runtime = runtimeTools.map(({ name }) => name);
  const declaredSet = new Set(declared);
  const runtimeSet = new Set(runtime);
  const missing = declared.filter((name) => !runtimeSet.has(name));
  const unexpected = runtime.filter((name) => !declaredSet.has(name));
  const declaredDuplicates = declared.filter((name, index) => declared.indexOf(name) !== index);
  const runtimeDuplicates = runtime.filter((name, index) => runtime.indexOf(name) !== index);
  const runtimeByName = new Map(runtimeTools.map((tool) => [tool.name, tool]));
  const metadataDrift = declaredTools.flatMap((declaredTool) => {
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

  if (
    missing.length > 0
    || unexpected.length > 0
    || declaredDuplicates.length > 0
    || runtimeDuplicates.length > 0
    || metadataDrift.length > 0
  ) {
    const details = [
      ...(missing.length > 0 ? [`missing at runtime: ${missing.join(', ')}`] : []),
      ...(unexpected.length > 0 ? [`not declared in manifest: ${unexpected.join(', ')}`] : []),
      ...(declaredDuplicates.length > 0
        ? [`manifest duplicates: ${[...new Set(declaredDuplicates)].join(', ')}`]
        : []),
      ...(runtimeDuplicates.length > 0
        ? [`runtime duplicates: ${[...new Set(runtimeDuplicates)].join(', ')}`]
        : []),
      ...(metadataDrift.length > 0
        ? [`description drift: ${JSON.stringify(metadataDrift, null, 2)}`]
        : []),
    ];
    throw new Error(`${manifestName} does not match runtime tools/list (${details.join('; ')})`);
  }
}

const manifests = [];
for (const name of ['manifest.json', 'manifest.private.json']) {
  const manifest = await readManifest(name);
  if (manifest !== null) manifests.push([name, manifest]);
}
if (manifests.length === 0) throw new Error('No MCPB manifest found.');

for (const [name, manifest] of manifests) {
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    throw new Error(`${name} has no declared tools.`);
  }
  const runtimeTools = await listRuntimeTools(name, manifest);
  if (writeGeneratedTools) {
    manifest.tools_generated = true;
    manifest.tools = runtimeTools.map((tool) => ({
      name: tool.name,
      ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
    }));
    await writeFile(resolve(root, name), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  compareToolContract(name, manifest.tools, runtimeTools);
  process.stdout.write(
    `✓ ${name}: ${writeGeneratedTools ? 'generated and verified' : 'tools/list matches'} `
    + `all ${runtimeTools.length} declared names and descriptions\n`,
  );
}
