import { join } from 'node:path';
import { readBooleanEnv, type Environment } from './config-core.js';
import { rootLogger } from './shared/logger.js';
import { atomicWriteJson, readUtf8FileBoundedSync } from './shared/persistence.js';
import { getStateDir } from './shared/state-paths.js';

/** The newest stable release a release source knows. */
export interface ReleaseInfo {
  readonly version: string;
  readonly url?: string;
}

/** Where this distribution learns about new releases, and how to update. */
export interface ReleaseSource {
  readonly fetchLatest: (timeoutMs: number) => Promise<ReleaseInfo | undefined>;
  readonly howToUpdate: string;
}

interface CachedCheck {
  readonly checkedAt: number;
  readonly latest: ReleaseInfo | null;
}

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 5_000;
const CACHE_FILE = 'update-check.json';
const MAX_CACHE_BYTES = 4 * 1024;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Semantic-version order: -1, 0 or 1, or undefined when either side is not
 * a version. A prerelease sorts before its release, so a beta of 4.1.0 is
 * older than 4.1.0.
 */
export function compareVersions(left: string, right: string): number | undefined {
  const a = VERSION_PATTERN.exec(left);
  const b = VERSION_PATTERN.exec(right);
  if (!a || !b) return undefined;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Math.sign(Number(a[index]) - Number(b[index]));
    if (difference !== 0) return difference;
  }
  const leftPre = a[4];
  const rightPre = b[4];
  if (leftPre === undefined || rightPre === undefined) {
    if (leftPre === rightPre) return 0;
    return leftPre === undefined ? 1 : -1;
  }
  const leftParts = leftPre.split('.');
  const rightParts = rightPre.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    const difference = compareIdentifiers(leftParts[index]!, rightParts[index]!);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function updateNotice(
  currentVersion: string,
  latest: ReleaseInfo,
  howToUpdate: string,
): string {
  return `Update available: German Legal MCP ${latest.version} has been released; `
    + `this server runs ${currentVersion}. Tell the user once, briefly, that an `
    + `update is available and how to install it: ${howToUpdate}`
    + (latest.url ? ` Release notes: ${latest.url}` : '');
}

export interface UpdateCheckerOptions {
  readonly source: ReleaseSource;
  readonly currentVersion: string;
  readonly cachePath?: string;
  readonly now?: () => number;
  readonly intervalMs?: number;
}

/**
 * Knows whether a newer release exists. The answer of the last check is kept
 * in the state directory so that a starting server can include it in its MCP
 * `instructions` without waiting for the network; `refresh()` asks the source
 * again at most every twelve hours. A failed check never affects the server.
 */
export class UpdateChecker {
  private readonly cachePath: string;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private cached: CachedCheck | undefined;

  constructor(private readonly options: UpdateCheckerOptions) {
    this.cachePath = options.cachePath ?? join(getStateDir(), CACHE_FILE);
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? CHECK_INTERVAL_MS;
    this.cached = this.readCache();
  }

  /** The notice for the release known now, or undefined when up to date. */
  notice(): string | undefined {
    const latest = this.cached?.latest;
    if (!latest || (compareVersions(latest.version, this.options.currentVersion) ?? 0) <= 0) {
      return undefined;
    }
    return updateNotice(this.options.currentVersion, latest, this.options.source.howToUpdate);
  }

  async refresh(): Promise<void> {
    if (this.cached && this.now() - this.cached.checkedAt < this.intervalMs) return;
    let latest: ReleaseInfo | undefined;
    try {
      latest = await this.options.source.fetchLatest(CHECK_TIMEOUT_MS);
    } catch (error) {
      rootLogger.debug('Release check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.cached = { checkedAt: this.now(), latest: latest ?? null };
    await atomicWriteJson(this.cachePath, this.cached).catch((error: unknown) => {
      rootLogger.debug('Release check result could not be stored', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private readCache(): CachedCheck | undefined {
    try {
      const value = JSON.parse(readUtf8FileBoundedSync(this.cachePath, MAX_CACHE_BYTES)) as unknown;
      if (!value || typeof value !== 'object') return undefined;
      const { checkedAt, latest } = value as { checkedAt?: unknown; latest?: unknown };
      if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return undefined;
      if (latest === null) return { checkedAt, latest: null };
      if (!latest || typeof latest !== 'object') return undefined;
      const { version, url } = latest as { version?: unknown; url?: unknown };
      if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return undefined;
      return {
        checkedAt,
        latest: { version, ...(typeof url === 'string' && url.startsWith('https://') ? { url } : {}) },
      };
    } catch {
      return undefined;
    }
  }
}

/** `GLMCP_UPDATE_CHECK=false` turns the check off, e.g. on machines without internet access. */
export function isUpdateCheckEnabled(env?: Environment): boolean {
  return readBooleanEnv('GLMCP_UPDATE_CHECK', true, env);
}
