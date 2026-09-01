#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const { isCanonicalToolName } = await import(
  pathToFileURL(resolve(root, 'dist/shared/tool-names.js')).href
);

async function readManifest(name) {
  try {
    return JSON.parse(await readFile(resolve(root, name), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

const manifests = [];
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
for (const name of ['manifest.json', 'manifest.private.json']) {
  const manifest = await readManifest(name);
  if (manifest !== null) manifests.push([name, manifest]);
}

if (manifests.length === 0) {
  throw new Error('No MCPB manifest found.');
}

for (const [name, manifest] of manifests) {
  if (manifest.version !== packageJson.version) {
    throw new Error(
      `${name} version ${String(manifest.version)} does not match package.json ${String(packageJson.version)}`,
    );
  }
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    throw new Error(`${name} has no declared tools.`);
  }
  const names = manifest.tools.map((tool) => tool?.name);
  const invalid = names.filter((toolName) =>
    typeof toolName !== 'string'
    || !isCanonicalToolName(toolName)
  );
  const duplicates = names.filter((toolName, index) => names.indexOf(toolName) !== index);

  if (invalid.length > 0 || duplicates.length > 0) {
    const details = [
      ...(invalid.length > 0 ? [`unsupported: ${invalid.join(', ')}`] : []),
      ...(duplicates.length > 0 ? [`duplicates: ${[...new Set(duplicates)].join(', ')}`] : []),
    ];
    throw new Error(`${name} has invalid MCP tool names (${details.join('; ')})`);
  }
  process.stdout.write(`✓ ${name}: ${names.length} canonical, unique tool names\n`);
}
