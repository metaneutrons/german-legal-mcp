#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const runtimeRoot = resolve(process.argv[2] ?? process.cwd());
const packagePath = resolve(runtimeRoot, 'package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const binEntry = typeof packageJson.bin === 'string'
  ? packageJson.bin
  : packageJson.bin?.['german-legal-mcp'] ?? Object.values(packageJson.bin ?? {})[0];
if (typeof binEntry !== 'string' || binEntry.length === 0) {
  throw new Error('Cannot prepare MCPB runtime: package.json declares no binary.');
}

// The MCPB already contains a production-only node_modules tree. Do not ship
// build/test hooks or development dependency declarations that are impossible
// to satisfy inside the final archive and make `npm sbom` reject that tree.
delete packageJson.devDependencies;
delete packageJson['lint-staged'];
packageJson.scripts = { start: `node ${binEntry}` };

await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
process.stdout.write(`Prepared production-only MCPB metadata for ${packageJson.name}@${packageJson.version}.\n`);
