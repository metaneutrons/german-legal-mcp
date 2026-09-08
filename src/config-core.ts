import { isIP } from 'node:net';

export type Environment = Readonly<Record<string, string | undefined>>;

export interface EnvironmentVariable {
  name: string;
  description: string;
  defaultValue?: string;
  secret?: boolean;
  /** Optional matcher for a documented family of dynamic variable names. */
  pattern?: RegExp;
}

export class ConfigurationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Configuration validation failed:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigurationError';
  }
}

export function getEnvironment(): Environment {
  return process.env;
}

export function readStringEnv(
  name: string,
  env: Environment = getEnvironment(),
): string | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (/^\$\{[^}]*\}$/.test(value)) return undefined;
  return value;
}

export function readBooleanEnv(
  name: string,
  defaultValue: boolean,
  env: Environment = getEnvironment(),
): boolean {
  const value = readStringEnv(name, env);
  if (value === undefined) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ConfigurationError([`${name} must be "true" or "false", received "${value}"`]);
}

export function readIntegerEnv(
  name: string,
  defaultValue: number,
  options: { min?: number; max?: number } = {},
  env: Environment = getEnvironment(),
): number {
  const raw = readStringEnv(name, env);
  if (raw === undefined) return defaultValue;
  if (!/^-?\d+$/.test(raw)) {
    throw new ConfigurationError([`${name} must be an integer, received "${raw}"`]);
  }
  const value = Number(raw);
  if (options.min !== undefined && value < options.min) {
    throw new ConfigurationError([`${name} must be at least ${options.min}, received ${value}`]);
  }
  if (options.max !== undefined && value > options.max) {
    throw new ConfigurationError([`${name} must be at most ${options.max}, received ${value}`]);
  }
  return value;
}

export function readUrlEnv(
  name: string,
  env: Environment = getEnvironment(),
): string | undefined {
  const value = readStringEnv(name, env);
  if (value === undefined) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    throw new ConfigurationError([`${name} must be a valid absolute URL`]);
  }
}

/** Read an operator-controlled browser/API URL with a strict public HTTPS origin. */
export function readHttpsUrlEnv(
  name: string,
  env: Environment = getEnvironment(),
): string | undefined {
  const value = readUrlEnv(name, env);
  if (value === undefined) return undefined;
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || (url.port !== '' && url.port !== '443')
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || isIP(hostname) !== 0
  ) {
    throw new ConfigurationError([
      `${name} must use a public HTTPS origin without credentials or a custom port`,
    ]);
  }
  return url.toString();
}

export function readEnumEnv<const T extends readonly string[]>(
  name: string,
  values: T,
  defaultValue: T[number],
  env: Environment = getEnvironment(),
): T[number] {
  const value = readStringEnv(name, env) ?? defaultValue;
  if (!values.includes(value)) {
    throw new ConfigurationError([
      `${name} must be one of ${values.join(', ')}, received "${value}"`,
    ]);
  }
  return value as T[number];
}

export function redactCataloguedEnvironment(
  variables: readonly EnvironmentVariable[],
  env: Environment = getEnvironment(),
): Record<string, string> {
  const exact = variables.flatMap((entry) => {
    if (entry.pattern) return [];
    const value = readStringEnv(entry.name, env);
    if (value === undefined) return [];
    return [[entry.name, entry.secret ? '[REDACTED]' : value]];
  });
  const dynamic = variables.flatMap((entry) => {
    if (!entry.pattern) return [];
    return Object.entries(env).flatMap(([name, rawValue]) => {
      if (!entry.pattern?.test(name)) return [];
      const value = rawValue?.trim();
      if (!value) return [];
      return [[name, entry.secret ? '[REDACTED]' : value]];
    });
  });
  return Object.fromEntries([...exact, ...dynamic]);
}

export function collectConfiguration<T extends Record<string, unknown>>(
  readers: { [K in keyof T]: () => T[K] },
): T {
  const result: Partial<T> = {};
  const issues: string[] = [];
  for (const [key, reader] of Object.entries(readers) as Array<
    [keyof T, () => T[keyof T]]
  >) {
    try {
      result[key] = reader();
    } catch (error) {
      if (error instanceof ConfigurationError) issues.push(...error.issues);
      else throw error;
    }
  }
  if (issues.length > 0) throw new ConfigurationError(issues);
  return result as T;
}

export const LOG_LEVELS = [
  'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent',
] as const;
export type LogLevel = typeof LOG_LEVELS[number];

export function getLogLevel(env: Environment = getEnvironment()): LogLevel {
  // LOG_LEVEL remains a compatibility fallback for pre-4.0 deployments. The
  // GLMCP-prefixed variable is authoritative when both are present.
  const normalized: Environment = {
    ...env,
    GLMCP_LOG_LEVEL: readStringEnv('GLMCP_LOG_LEVEL', env)
      ?? readStringEnv('LOG_LEVEL', env),
  };
  return readEnumEnv('GLMCP_LOG_LEVEL', LOG_LEVELS, 'info', normalized);
}

/**
 * Identifies this tool to plain HTTP APIs, and is meant to: those are public
 * interfaces where saying who is calling is the courtesy. There is deliberately
 * no browser counterpart here — a pinned browser identity contradicts the
 * client hints the browser goes on reporting for itself, so a real browser's
 * identity is read from the browser (see `shared/browser-identity.ts`) rather
 * than declared in configuration.
 */
export const HTTP_USER_AGENT = 'Mozilla/5.0 (compatible; German-Legal-MCP/1.0)';
