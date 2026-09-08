import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the shared state root used by a Vitest process.
 *
 * A fresh directory is created eagerly so parallel workers cannot race to
 * create the root with their ambient umask. Explicit operator configuration
 * remains authoritative and is never chmodded by the test harness.
 */
export function resolveVitestStateDir(prefix: string): string {
  const configured = process.env.GLMCP_STATE_DIR;
  if (configured !== undefined) return configured;

  const directory = mkdtempSync(join(tmpdir(), prefix));
  if (process.platform !== 'win32') chmodSync(directory, 0o700);
  return directory;
}
