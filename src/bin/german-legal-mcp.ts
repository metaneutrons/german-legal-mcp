#!/usr/bin/env node
import { looksLikeToolInvocation } from '../cli.js';
import { getLogLevel } from '../config-core.js';
import { getPackageMetadata } from '../package-metadata.js';

async function main(): Promise<number | undefined> {
  getLogLevel();
  const argv = process.argv.slice(2);
  const commandLine = argv.length > 0 && (
    looksLikeToolInvocation(argv)
    || argv.includes('--help') || argv.includes('-h')
    || argv.includes('--version') || argv.includes('-v')
  );
  if (commandLine) {
    const { runCommandLine } = await import('./cli-main.js');
    return runCommandLine(argv, getPackageMetadata());
  }
  const { runMcpProcess } = await import('./mcp-main.js');
  await runMcpProcess();
  return undefined;
}

try {
  const exitCode = await main();
  if (exitCode !== undefined) process.exitCode = exitCode;
} catch (error) {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[german-legal-mcp] FATAL: startup failed\n${detail}\n`);
  process.exitCode = 1;
}
