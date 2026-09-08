import pino from 'pino';
import { join } from 'path';
import { getLogLevel } from '../config.js';
import { LOG_DIR, STATE_DIR } from './state-paths.js';
import { ensurePrivateDirectorySync } from './state-security.js';

/**
 * Context keys whose values are credentials or session material and must never
 * reach a log sink. Matched at the top level and one level of nesting
 * (e.g. `error.password`). Case-sensitive, per pino's redaction paths.
 */
export const SENSITIVE_LOG_KEYS = [
  'password', 'pwd', 'cookie', 'cookies', 'setCookie', 'set-cookie',
  'token', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
  'idToken', 'id_token', 'apiKey', 'apikey', 'authorization', 'auth',
  'secret', 'tenantKey', 'credential', 'credentials',
  'octaToken', 'xSHI', 'xSHISecurity', 'csrfToken', 'jsessionId', 'jwtCookie',
  'qurl',
] as const;

/**
 * Query parameters that commonly carry session tokens or one-time credentials.
 *
 * The SAML group is here because federated web sign-on carries its material in
 * the query string. `samlresponse` is the one that matters most: it holds the
 * signed assertion, which is the authenticated identity plus every attribute
 * the identity provider released. `execution` is such a provider's flow key.
 * A username is personal data even where it is not a secret, so it goes too.
 *
 * Wrapper parameters such as `qurl` may contain a complete second URL,
 * including OIDC codes, userinfo or another encoded redirect. They are
 * therefore redacted as a unit; the outer origin and path retain the useful
 * diagnostic signal without trying to prove an arbitrarily nested value safe.
 */
const SENSITIVE_QUERY_PARAMS = new Set([
  'token', 'ticket', 'code', 'session', 'sessionid', 'jsessionid', 'jwt',
  'password', 'pwd', 'auth', 'access_token', 'id_token', 'refresh_token',
  'api_key', 'apikey', 'key', 'secret', 'signature', 'sig',
  'samlrequest', 'samlresponse', 'relaystate', 'execution',
  'j_username', 'j_password', 'user', 'username', 'uid', 'pass', 'passwd',
  'qurl',
]);

const MAX_LOG_URL_CHARS = 16 * 1024;
const MAX_NESTED_QUERY_VALUE_CHARS = 8 * 1024;
const MAX_QUERY_PARAMETERS = 64;
const MAX_PERCENT_DECODE_LAYERS = 4;
const MAX_LOG_TEXT_CHARS = 32 * 1024;
const MAX_LOG_CONTEXT_DEPTH = 8;
const MAX_LOG_COLLECTION_ENTRIES = 100;
const REDACT_CENSOR = '[redacted]';
const OVERSIZED_URL_CENSOR = '[redacted:oversized-url]';

function boundedPercentDecode(raw: string): string | null {
  if (raw.length > MAX_NESTED_QUERY_VALUE_CHARS) return null;
  let value = raw;
  for (let depth = 0; depth < MAX_PERCENT_DECODE_LAYERS; depth++) {
    if (!/%[0-9a-f]{2}/i.test(value)) {
      // A stray percent sign makes the encoding ambiguous. Nested values fail
      // closed instead of preserving a string we cannot classify reliably.
      return value.includes('%') ? null : value;
    }
    try {
      const decoded = decodeURIComponent(value);
      if (decoded.length > MAX_NESTED_QUERY_VALUE_CHARS) return null;
      if (decoded === value) return value;
      value = decoded;
    } catch {
      return null;
    }
  }
  // More encoding layers can hide a sensitive key or URL beyond our CPU
  // budget. Treat the value as unsafe instead of decoding without a bound.
  return /%[0-9a-f]{2}/i.test(value) ? null : value;
}

function normalizedQueryName(name: string): string | null {
  return boundedPercentDecode(name)?.toLowerCase() ?? null;
}

function hasAbsoluteUrlScheme(value: string): boolean {
  const separator = value.indexOf(':');
  if (separator < 1 || value.slice(separator + 1, separator + 3) !== '//') return false;
  return /^[a-z][a-z\d+.-]*$/i.test(value.slice(0, separator));
}

function hasBoundedQueryAssignment(fragment: string): boolean {
  const separator = fragment.indexOf('=');
  return separator > 0 && separator <= 128;
}

function hasQueryAssignment(value: string): boolean {
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    const character = value[index];
    if (index !== value.length && character !== '?' && character !== '&' && character !== '#') {
      continue;
    }
    if (hasBoundedQueryAssignment(value.slice(start, index))) return true;
    start = index + 1;
  }
  return false;
}

function looksLikeNestedUrlOrQuery(value: string): boolean {
  const decoded = boundedPercentDecode(value);
  if (decoded === null) return true;
  return hasAbsoluteUrlScheme(decoded) || decoded.startsWith('//') || hasQueryAssignment(decoded);
}

function sanitizeParsedUrl(url: URL): string {
  if (url.username) url.username = '';
  if (url.password) url.password = '';

  const sanitized = new URLSearchParams();
  let count = 0;
  for (const [name, value] of url.searchParams) {
    count++;
    if (count > MAX_QUERY_PARAMETERS) {
      url.search = `redacted=${encodeURIComponent('[too-many-query-parameters]')}`;
      url.hash = '';
      return url.toString();
    }
    const normalized = normalizedQueryName(name);
    const redact = normalized === null
      || SENSITIVE_QUERY_PARAMS.has(normalized)
      || looksLikeNestedUrlOrQuery(value);
    sanitized.append(name, redact ? REDACT_CENSOR : value);
  }
  url.search = sanitized.toString();

  if (url.hash) {
    const fragment = url.hash.slice(1);
    if (looksLikeNestedUrlOrQuery(fragment)) url.hash = REDACT_CENSOR;
  }
  return url.toString();
}

/**
 * Strip credentials from a URL before logging: remove any `user:pass@` userinfo
 * and redact the values of sensitive query parameters, while keeping the URL
 * shape useful for diagnostics. Never throws — falls back to a regex strip.
 */
export function sanitizeUrl(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) return raw;
  if (raw.length > MAX_LOG_URL_CHARS) return OVERSIZED_URL_CENSOR;
  try {
    return sanitizeParsedUrl(new URL(raw));
  } catch {
    try {
      if (raw.startsWith('//')) {
        return sanitizeParsedUrl(new URL(`https:${raw}`)).slice('https:'.length);
      }
      if (raw.includes('?') || raw.includes('#')) {
        const relative = sanitizeParsedUrl(new URL(raw, 'https://log.invalid/'));
        const parsed = new URL(relative);
        const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        return raw.startsWith('/') ? path : path.replace(/^\//, '');
      }
    } catch {
      return REDACT_CENSOR;
    }
    // Plain vpath: retain it, but strip any inline userinfo-like credential.
    return raw.replace(/(\/\/)[^/@\s]+:[^/@\s]+@/, '$1[redacted]@');
  }
}

const INLINE_SECRET_NAME_SET = new Set([
  ...SENSITIVE_LOG_KEYS,
  'bearer', 'proxy-authorization', 'x-api-key',
].map((key) => key.toLowerCase()));

const INLINE_ASSIGNMENT_START = /\b([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*/g;
const EMBEDDED_URL_PATTERN = /\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi;
const AUTHORIZATION_CREDENTIAL_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

function isInlineAssignmentDelimiter(character: string): boolean {
  return character === ',' || character === ';' || character === '&' || character.trim() === '';
}

/** Return the exclusive end of one quoted or unquoted assignment value. */
function inlineAssignmentValueEnd(raw: string, start: number): number {
  const quote = raw[start];
  let offset = start;

  if (quote === '"' || quote === "'") {
    offset++;
    let escaped = false;
    while (offset < raw.length) {
      const character = raw[offset];
      offset++;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        break;
      }
    }
  }

  while (offset < raw.length && !isInlineAssignmentDelimiter(raw[offset] ?? '')) offset++;
  return offset;
}

/**
 * Redact sensitive assignments without building a regular expression from the
 * configured key names. Non-sensitive matches are rescanned after their key so
 * that an outer construct such as `https://...?token=...` cannot hide a nested
 * sensitive assignment by consuming the complete URL as one candidate.
 */
function redactInlineSecretAssignments(raw: string): string {
  let cursor = 0;
  let changed = false;
  let result = '';
  INLINE_ASSIGNMENT_START.lastIndex = 0;

  for (;;) {
    const match = INLINE_ASSIGNMENT_START.exec(raw);
    if (!match) break;
    const name = match[1];
    if (!name) continue;
    if (!INLINE_SECRET_NAME_SET.has(name.toLowerCase())) {
      INLINE_ASSIGNMENT_START.lastIndex = match.index + name.length;
      continue;
    }
    const valueEnd = inlineAssignmentValueEnd(raw, INLINE_ASSIGNMENT_START.lastIndex);
    result += `${raw.slice(cursor, match.index)}${name}=${REDACT_CENSOR}`;
    cursor = valueEnd;
    INLINE_ASSIGNMENT_START.lastIndex = valueEnd;
    changed = true;
  }

  return changed ? `${result}${raw.slice(cursor)}` : raw;
}

function sanitizeEmbeddedUrls(raw: string): string {
  return raw.replace(EMBEDDED_URL_PATTERN, (candidate) => sanitizeUrl(candidate));
}

function redactAuthorizationCredentials(raw: string): string {
  return raw.replace(
    AUTHORIZATION_CREDENTIAL_PATTERN,
    (_credential, scheme: string) => `${scheme} ${REDACT_CENSOR}`,
  );
}

/** Sanitize URLs, credentials and common key/value secrets embedded in text. */
export function sanitizeLogText(raw: string): string {
  if (!raw) return raw;
  const truncated = raw.length > MAX_LOG_TEXT_CHARS;
  let value = sanitizeEmbeddedUrls(raw.slice(0, MAX_LOG_TEXT_CHARS));
  // Redact the whole authorization credential before the generic key/value
  // rule can consume just the scheme word and leave the token behind.
  value = redactAuthorizationCredentials(value);
  value = redactInlineSecretAssignments(value);
  return truncated ? `${value} [truncated]` : value;
}

const SENSITIVE_KEY_SET = new Set<string>(SENSITIVE_LOG_KEYS.map((key) => key.toLowerCase()));

function isSensitiveLogKey(key: string | undefined): boolean {
  const normalized = key?.toLowerCase() ?? '';
  return SENSITIVE_KEY_SET.has(normalized)
    || /(?:password|passwd|secret|token|cookie|authorization|credential)$/.test(normalized);
}

function sanitizeErrorValue(error: Error): LogContext {
  return {
    name: sanitizeLogText(error.name),
    message: sanitizeLogText(error.message),
    stack: error.stack ? sanitizeLogText(error.stack) : undefined,
  };
}

function sanitizeObjectValue(
  value: object,
  seen: WeakSet<object>,
  depth: number,
): LogContext {
  const sanitized: Record<string, unknown> = {};
  let count = 0;
  for (const nestedKey in value) {
    if (!Object.prototype.hasOwnProperty.call(value, nestedKey)) continue;
    if (count >= MAX_LOG_COLLECTION_ENTRIES) {
      sanitized._truncated = '[truncated]';
      break;
    }
    count++;
    let nestedValue: unknown;
    try {
      nestedValue = (value as Record<string, unknown>)[nestedKey];
    } catch {
      nestedValue = '[unavailable]';
    }
    sanitized[nestedKey] = sanitizeLogValue(nestedValue, nestedKey, seen, depth + 1);
  }
  return sanitized;
}

function sanitizeLogValue(
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  const normalizedKey = key?.toLowerCase() ?? '';
  if (isSensitiveLogKey(key)) return REDACT_CENSOR;
  if (typeof value === 'string') {
    return normalizedKey === 'url' || normalizedKey === 'href'
      ? sanitizeUrl(value)
      : sanitizeLogText(value);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_LOG_CONTEXT_DEPTH) return '[truncated]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) return sanitizeErrorValue(value);
  if (Array.isArray(value)) {
    const sanitized = value.slice(0, MAX_LOG_COLLECTION_ENTRIES)
      .map((entry) => sanitizeLogValue(entry, undefined, seen, depth + 1));
    if (value.length > MAX_LOG_COLLECTION_ENTRIES) sanitized.push('[truncated]');
    return sanitized;
  }
  return sanitizeObjectValue(value, seen, depth);
}

export function sanitizeLogContext(context: LogContext): LogContext {
  return sanitizeLogValue(context, undefined, new WeakSet<object>(), 0) as LogContext;
}

// Redact known-sensitive keys at the top level and one level deep, and rewrite
// any `url`/`href` value through the credential-stripping sanitizer.
const redactPaths = [
  ...SENSITIVE_LOG_KEYS,
  ...SENSITIVE_LOG_KEYS.map((k) => `*.${k}`),
  'url', '*.url', 'href', '*.href',
];
export const LOG_REDACT_CONFIG: NonNullable<pino.LoggerOptions['redact']> = {
  paths: redactPaths,
  censor: (value: unknown, path: string[]): unknown => {
    const leaf = path[path.length - 1];
    if (leaf === 'url' || leaf === 'href') return sanitizeUrl(String(value));
    return REDACT_CENSOR;
  },
};

let logger: pino.Logger | undefined;

function getLogger(): pino.Logger {
  if (logger) return logger;
  const level = getLogLevel();
  ensurePrivateDirectorySync(STATE_DIR);
  ensurePrivateDirectorySync(LOG_DIR);
  const targets: pino.TransportTargetOptions[] = [
    {
      target: 'pino-pretty',
      level,
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        destination: 2,
      },
    },
    {
      target: 'pino-roll',
      level,
      options: {
        file: join(LOG_DIR, 'mcp'),
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        extension: '.log',
        limit: { count: 7 },
        size: '10m',
        mkdir: false,
        mode: 0o600,
      },
    },
  ];
  const transport = pino.transport({ targets });
  logger = pino({ level, redact: LOG_REDACT_CONFIG }, transport);
  return logger;
}

export type LogContext = {
  /** Provider namespace, e.g. `ris`, `legis`. */
  provider?: string;
  /** Module or component within a provider, e.g. `ris-provider`. */
  module?: string;
  /** Correlates all log lines of one logical request across processes. */
  requestId?: string | undefined;
  operation?: string;
  vpath?: string;
  url?: string;
  /** Wall-clock duration of an operation, in milliseconds. */
  durationMs?: number;
  /** @deprecated Use {@link durationMs}. Kept for back-compat. */
  duration?: number;
  [key: string]: unknown;
};

export class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  debug(msg: string, context?: LogContext): void {
    getLogger().debug(sanitizeLogContext({ ...this.context, ...context }), sanitizeLogText(msg));
  }

  info(msg: string, context?: LogContext): void {
    getLogger().info(sanitizeLogContext({ ...this.context, ...context }), sanitizeLogText(msg));
  }

  warn(msg: string, context?: LogContext): void {
    getLogger().warn(sanitizeLogContext({ ...this.context, ...context }), sanitizeLogText(msg));
  }

  error(msg: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext = error instanceof Error ? {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    } : { error };
    getLogger().error(
      sanitizeLogContext({ ...this.context, ...context, ...errorContext }),
      sanitizeLogText(msg),
    );
  }
}

export const rootLogger = new Logger();
