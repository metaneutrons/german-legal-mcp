#!/usr/bin/env node
/**
 * Startup smoke test for the published entrypoint. Validates that the built
 * package.json's declared binary actually loads and runs — catching broken
 * imports, a config module that throws, or a packaging mistake that `npm run
 * build` alone would not surface. Four checks:
 *
 *   1. `--version` prints the package version and exits 0 (entrypoint + config
 *      parse without starting the server).
 *   2. Plain start boots the MCP server, connects the stdio transport and logs
 *      readiness within a timeout, then is terminated.
 *   3. CLI mode's own `--help` for a real tool prints its options and exits 0
 *      — network-free, since it only inspects the tool's schema.
 *   4. An unknown tool name in CLI mode exits 1 rather than falling through to
 *      MCP server startup, which is the actual risk this mode introduces: the
 *      branch that decides "CLI or server" must never guess wrong.
 *
 * Runs as part of `npm run verify`, after the package contents are checked.
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const binEntry = typeof packageJson.bin === 'string'
  ? packageJson.bin
  : packageJson.bin?.['german-legal-mcp'] ?? Object.values(packageJson.bin ?? {})[0];
if (typeof binEntry !== 'string' || binEntry.length === 0) {
  throw new Error('package.json declares no german-legal-mcp binary entry point.');
}
const entry = join(root, binEntry);
const pkgVersion = packageJson.version;

function fail(msg) {
  console.error(`Startup smoke FAILED: ${msg}`);
  process.exit(1);
}

function run(args, { timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env: { ...getDefaultEnvironment(), ...env },
      // Keep stdin open so server mode does not see EOF and exit immediately.
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });

    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => {
        // Server mode never exits on its own — terminate and report what we saw.
        child.kill('SIGTERM');
        resolve({ timedOut: true, stdout, stderr, code: null });
      }, timeoutMs);
    }
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ timedOut: false, stdout, stderr, code });
    });
  });
}

// --- Check 1: --version
const v = await run(['--version'], { timeoutMs: 15_000 });
if (v.code !== 0) fail(`--version exited with code ${v.code}\n${v.stderr}`);
if (!v.stdout.includes(pkgVersion)) {
  fail(`--version printed "${v.stdout.trim()}", expected to contain "${pkgVersion}"`);
}
console.log(`✓ --version → ${pkgVersion}`);

// --- Check 2: server boots and reports readiness
const stateDir = mkdtempSync(join(tmpdir(), 'glmcp-smoke-'));
const s = await run([], { timeoutMs: 8_000, env: { GLMCP_STATE_DIR: stateDir, GLMCP_LOG_LEVEL: 'info' } });
// Success is the readiness log. The server may keep running (timed out, then
// terminated) or exit 0 if its stdin closes — both are fine; a non-zero exit
// before readiness is not.
if (!s.stderr.includes('MCP server connected and ready')) {
  fail(`server did not report readiness\n${s.stderr}`);
}
if (!s.timedOut && s.code !== 0) {
  fail(`server exited with code ${s.code}\n${s.stderr}`);
}
console.log('✓ server booted and reported readiness');

// --- Check 3: CLI mode --help for a real tool, no network involved
// Asserts on formatToolHelp()'s distinguishing output shape, not just
// substrings the global --help text also happens to contain (the tool list
// includes "arxiv_search" and the usage block includes "OPTIONS:") — a
// looser check here previously stayed green while argv order made
// `arxiv_search --help` fall through to the *global* help instead of the
// tool's own.
const h = await run(['arxiv_search', '--help'], { timeoutMs: 10_000 });
if (h.code !== 0) fail(`CLI --help exited with code ${h.code}\n${h.stderr}`);
if (!h.stdout.startsWith('arxiv_search — ') || h.stdout.includes('TOOLS (')) {
  fail(`CLI --help printed unexpected output (looks like the global --help):\n${h.stdout}`);
}
console.log('✓ CLI mode: arxiv_search --help');

// --- Check 4: an unknown tool name exits 1, not the MCP server
const u = await run(['nope_nope'], { timeoutMs: 10_000 });
if (u.code !== 1) fail(`unknown tool exited with code ${u.code}, expected 1\n${u.stderr}`);
if (u.stderr.includes('MCP server connected and ready')) {
  fail('unknown tool name fell through to MCP server startup');
}
console.log('✓ CLI mode: unknown tool exits 1 without starting the server');

console.log('Startup smoke passed.');
