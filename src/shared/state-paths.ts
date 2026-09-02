import { homedir } from 'node:os';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';
import { getEnvironment, readStringEnv, type Environment } from '../config.js';

const APP_DIR_NAME = 'german-legal-mcp';

export interface StatePathEnvironment extends Environment {
  XDG_STATE_HOME?: string;
  LOCALAPPDATA?: string;
}

export interface StatePathOptions {
  env?: StatePathEnvironment;
  platform?: typeof process.platform;
  homeDir?: string;
  currentDir?: string;
}

/**
 * Non-configurable platform default used by process-wide rendezvous points.
 * Keep this beside getStateDir so providers never reconstruct application
 * state roots from home/XDG conventions themselves.
 */
export function getDefaultStateDir(options: StatePathOptions = {}): string {
  const env = options.env ?? getEnvironment();
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA?.trim() || join(homeDir, 'AppData', 'Local'), APP_DIR_NAME);
  }
  return join(homeDir, '.local', 'share', APP_DIR_NAME);
}

/** XDG-derived state root, even when GLMCP_STATE_DIR currently overrides it. */
export function getXdgStateDir(options: StatePathOptions = {}): string | undefined {
  const env = options.env ?? getEnvironment();
  const configured = env.XDG_STATE_HOME?.trim();
  return configured ? join(configured, APP_DIR_NAME) : undefined;
}

function isSameOrAncestor(candidate: string, target: string): boolean {
  const relation = relative(candidate, target);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function assertNarrowConfiguredRoot(
  variable: 'GLMCP_STATE_DIR' | 'GLMCP_EXPORT_DIR',
  candidate: string,
  homeDir: string,
  currentDir: string,
): string {
  const path = resolve(candidate);
  if (path === parse(path).root) {
    throw new Error(`${variable} must not be a filesystem root: ${path}`);
  }
  for (const [label, protectedPath] of [
    ['home directory', resolve(homeDir)],
    ['current workspace', resolve(currentDir)],
  ] as const) {
    if (isSameOrAncestor(path, protectedPath)) {
      throw new Error(`${variable} must not be the ${label} or one of its ancestors: ${path}`);
    }
  }
  return path;
}

export function getStateDir(options: StatePathOptions = {}): string {
  const env = options.env ?? getEnvironment();
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const currentDir = options.currentDir ?? process.cwd();
  const configured = readStringEnv('GLMCP_STATE_DIR', env);

  if (configured) {
    const candidate = isAbsolute(configured) ? configured : resolve(currentDir, configured);
    return assertNarrowConfiguredRoot(
      'GLMCP_STATE_DIR',
      candidate,
      homeDir,
      currentDir,
    );
  }
  const xdgStateDir = getXdgStateDir(options);
  if (xdgStateDir !== undefined) return xdgStateDir;
  return getDefaultStateDir({ ...options, env, platform, homeDir });
}

/**
 * Root for user-requested document exports. Keeping exports inside one
 * configured directory prevents an MCP tool call from becoming a general
 * arbitrary-file-write primitive.
 */
export function getExportDir(options: StatePathOptions = {}): string {
  const env = options.env ?? getEnvironment();
  const homeDir = options.homeDir ?? homedir();
  const currentDir = options.currentDir ?? process.cwd();
  const configured = readStringEnv('GLMCP_EXPORT_DIR', env);
  if (configured) {
    const candidate = isAbsolute(configured) ? configured : resolve(currentDir, configured);
    return assertNarrowConfiguredRoot(
      'GLMCP_EXPORT_DIR',
      candidate,
      homeDir,
      currentDir,
    );
  }
  return join(getStateDir(options), 'exports');
}

export const DEFAULT_STATE_DIR = getDefaultStateDir();
export const STATE_DIR = getStateDir();
export const CACHE_DIR = join(STATE_DIR, 'cache');
export const LOG_DIR = join(STATE_DIR, 'logs');
export const SESSION_DIR = join(STATE_DIR, 'sessions');
export const METRICS_DIR = join(STATE_DIR, 'metrics');
export const SOCKET_DIR = join(STATE_DIR, 'sockets');
export const LOCK_DIR = join(STATE_DIR, 'locks');
export const EXPORT_DIR = getExportDir();
/**
 * Persistent browser profiles — Chrome's own `userDataDir`, not our state.
 *
 * Separate from SESSION_DIR on purpose. A session file is a jar of cookies we
 * captured and can rewrite at will; a profile is a directory Chrome owns
 * exclusively while it runs, holds far more than cookies (local storage, the
 * history and device state an identity provider reads to recognise a browser
 * it has seen before), and is safe to delete only when no browser has it open.
 */
export const PROFILE_DIR = join(STATE_DIR, 'profiles');

/** Every state root that is safely derivable from the current configuration. */
export function getKnownStateDirs(options: StatePathOptions = {}): string[] {
  const roots = [
    getDefaultStateDir(options),
    getStateDir(options),
    getXdgStateDir(options),
  ].filter((value): value is string => value !== undefined);
  return [...new Set(roots)];
}

export function socketDirectoryForStateDir(root: string): string {
  return join(root, 'sockets');
}

export function lockDirectoryForStateDir(root: string): string {
  return join(root, 'locks');
}

export function socketPathForStateDir(root: string, ...segments: string[]): string {
  return join(socketDirectoryForStateDir(root), ...segments);
}

export function lockPathForStateDir(root: string, ...segments: string[]): string {
  return join(lockDirectoryForStateDir(root), ...segments);
}

export function statePath(...segments: string[]): string {
  return join(STATE_DIR, ...segments);
}

export function cachePath(...segments: string[]): string {
  return join(CACHE_DIR, ...segments);
}

export function sessionPath(...segments: string[]): string {
  return join(SESSION_DIR, ...segments);
}

export function metricsPath(...segments: string[]): string {
  return join(METRICS_DIR, ...segments);
}

export function socketPath(...segments: string[]): string {
  return join(SOCKET_DIR, ...segments);
}

export function lockPath(...segments: string[]): string {
  return join(LOCK_DIR, ...segments);
}

export function profilePath(...segments: string[]): string {
  return join(PROFILE_DIR, ...segments);
}
