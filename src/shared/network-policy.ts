import type {
  AxiosInstance,
  LookupAddress,
  LookupAddressEntry,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import { isIP } from 'node:net';
import {
  isBlockedAddress,
  normalizedIpLiteral,
  systemHostResolver,
  type HostResolver,
} from './network-address-policy.js';
import { withTimeout } from './timeout.js';

export {
  isBlockedAddress,
  systemHostResolver,
  type HostResolver,
  type ResolvedAddress,
} from './network-address-policy.js';

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
export const MAX_NETWORK_RESPONSE_BYTES = 64 * 1024 * 1024;
const DEFAULT_NETWORK_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_NETWORK_REQUEST_BYTES = 64 * 1024 * 1024;

/** A literal path is exact; a regular expression describes a reviewed path family. */
export type NetworkPath = string | RegExp;

/** One exact HTTPS origin and the paths this provider is allowed to request. */
export interface NetworkRule {
  readonly hostname: string;
  readonly paths: readonly NetworkPath[];
}

/**
 * Outbound policy for one provider operation. Rules are intentionally exact:
 * callers must name every upstream host and every path family they use.
 */
export interface NetworkPolicy {
  readonly name: string;
  readonly rules: readonly NetworkRule[];
  /** Cross-origin redirects are denied unless a flow explicitly opts in. */
  readonly allowCrossOriginRedirects?: boolean;
}

export interface SafeRequestOptions {
  /**
   * Tests commonly inject an in-memory Axios-shaped transport. The default
   * performs DNS checks for the real Axios singleton and skips them for such
   * trusted injected transports; callers may override this explicitly.
   */
  readonly resolveDns?: boolean;
  readonly resolver?: HostResolver;
  /** Explicit opt-in for trusted bulk APIs; never allowed above 64 MiB. */
  readonly maxRequestBytes?: number;
}

/** Reject path/query syntax when a tool argument is meant to be an opaque id. */
export function assertOpaqueIdentifier(
  value: string,
  label: string,
  pattern: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/,
): string {
  pattern.lastIndex = 0;
  if (!pattern.test(value) || containsControlCharacter(value)) {
    throw new Error(`${label} must be the opaque identifier returned by the provider search.`);
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function rejectEncodedTraversal(rawUrl: string, policyName: string): void {
  const withoutQuery = rawUrl.split(/[?#]/, 1)[0] ?? rawUrl;
  if (withoutQuery.includes('\\')) {
    throw new Error(`${policyName} network policy rejected a backslash in the URL path.`);
  }
  if (/%(?:00|2f|5c)/i.test(withoutQuery)) {
    throw new Error(`${policyName} network policy rejected an encoded path separator.`);
  }
  for (const rawSegment of withoutQuery.split(/[\\/]/)) {
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      throw new Error(`${policyName} network policy rejected malformed URL encoding.`);
    }
    if (segment === '.' || segment === '..' || segment.includes('\0')) {
      throw new Error(`${policyName} network policy rejected path traversal.`);
    }
  }
}

function matchesPath(pathname: string, patterns: readonly NetworkPath[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') return pathname === pattern;
    pattern.lastIndex = 0;
    return pattern.test(pathname);
  });
}

/** Parse and synchronously enforce scheme, authority, origin and path rules. */
export function assertUrlAllowed(rawUrl: string, policy: NetworkPolicy): URL {
  rejectEncodedTraversal(rawUrl, policy.name);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${policy.name} network policy rejected a malformed URL.`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${policy.name} network policy requires HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${policy.name} network policy rejected URL userinfo.`);
  }
  if (url.port && url.port !== '443') {
    throw new Error(`${policy.name} network policy rejected non-default port ${url.port}.`);
  }

  const hostname = url.hostname.toLowerCase();
  const ipLiteral = normalizedIpLiteral(hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isIP(ipLiteral) !== 0) {
    throw new Error(`${policy.name} network policy rejected a local or literal-IP host.`);
  }

  const rule = policy.rules.find((candidate) => candidate.hostname.toLowerCase() === hostname);
  if (!rule) {
    throw new Error(`${policy.name} network policy rejected host ${hostname}.`);
  }
  if (!matchesPath(url.pathname, rule.paths)) {
    throw new Error(`${policy.name} network policy rejected path ${url.pathname}.`);
  }
  return url;
}

/** Resolve the already-allowlisted host and reject every non-public answer. */
export async function assertResolvedUrlAllowed(
  rawUrl: string,
  policy: NetworkPolicy,
  resolver: HostResolver = systemHostResolver,
  resolutionTimeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<URL> {
  const url = assertUrlAllowed(rawUrl, policy);
  await resolvePublicAddresses(url, policy, resolver, resolutionTimeoutMs);
  return url;
}

function locationHeader(response: AxiosResponse<unknown>): string | undefined {
  const location = response.headers?.location;
  return typeof location === 'string' ? location : undefined;
}

function responseUrl(response: AxiosResponse<unknown>): string | undefined {
  const request = response.request as {
    res?: { responseUrl?: unknown };
  } | undefined;
  return typeof request?.res?.responseUrl === 'string'
    ? request.res.responseUrl
    : undefined;
}

function redirectStatus(status: number | undefined): boolean {
  return status !== undefined && status >= 300 && status < 400;
}

function redirectLimit(config: AxiosRequestConfig): number {
  const requested = config.maxRedirects ?? MAX_REDIRECTS;
  return Math.max(0, Math.min(requested, MAX_REDIRECTS));
}

function requestAcceptsStatus(config: AxiosRequestConfig, status: number): boolean {
  const accepts = config.validateStatus ?? ((value: number) => value >= 200 && value < 300);
  return redirectStatus(status) || accepts(status);
}

function boundedAxiosConfig(
  config: AxiosRequestConfig,
  requestCeiling = DEFAULT_NETWORK_REQUEST_BYTES,
): AxiosRequestConfig {
  const bounded = (value: number | undefined, fallback: number, ceiling: number): number => (
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.min(value, ceiling)
      : fallback
  );
  return {
    ...config,
    timeout: bounded(config.timeout, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxContentLength: bounded(
      config.maxContentLength,
      MAX_NETWORK_RESPONSE_BYTES,
      MAX_NETWORK_RESPONSE_BYTES,
    ),
    maxBodyLength: bounded(
      config.maxBodyLength,
      requestCeiling,
      requestCeiling,
    ),
  };
}

async function validateRequestUrl(
  rawUrl: string,
  policy: NetworkPolicy,
  resolveDns: boolean,
  resolver: HostResolver,
  resolutionTimeoutMs: number,
): Promise<ValidatedRequest> {
  const url = assertUrlAllowed(rawUrl, policy);
  if (!resolveDns) return { url };

  const answers = await resolvePublicAddresses(
    url,
    policy,
    resolver,
    resolutionTimeoutMs,
  );
  return { url, lookup: pinnedLookup(url.hostname, answers) };
}

interface ValidatedRequest {
  readonly url: URL;
  readonly lookup?: NonNullable<AxiosRequestConfig['lookup']>;
}

async function resolvePublicAddresses(
  url: URL,
  policy: NetworkPolicy,
  resolver: HostResolver,
  resolutionTimeoutMs: number,
): Promise<LookupAddressEntry[]> {
  const timeoutMs = Number.isFinite(resolutionTimeoutMs) && resolutionTimeoutMs > 0
    ? Math.min(resolutionTimeoutMs, MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  // Node's dns.lookup has no AbortSignal/deadline. Race it before any
  // credential-bearing transport call; Promise.race keeps a rejection handler
  // attached to a resolver that settles after the timeout.
  const answers = await withTimeout(
    resolver(url.hostname),
    timeoutMs,
    `${policy.name} DNS resolution`,
  );
  if (answers.length === 0) {
    throw new Error(`${policy.name} network policy could not resolve ${url.hostname}.`);
  }
  return answers.map((answer) => {
    const address = normalizedIpLiteral(answer.address);
    const family = isIP(address);
    if ((family !== 4 && family !== 6)
      || family !== answer.family
      || isBlockedAddress(address)) {
      throw new Error(
        `${policy.name} network policy rejected non-public address ${answer.address} for ${url.hostname}.`,
      );
    }
    return { address, family };
  });
}

function pinnedLookup(
  expectedHostname: string,
  addresses: readonly LookupAddressEntry[],
): NonNullable<AxiosRequestConfig['lookup']> {
  return ((
    hostname: string,
    options: { all?: boolean; family?: number | string },
    callback: (
      error: Error | null,
      address: LookupAddress | LookupAddress[],
      family?: 4 | 6,
    ) => void,
  ): void => {
    if (hostname.toLowerCase() !== expectedHostname.toLowerCase()) {
      callback(new Error(`Network policy refused DNS lookup for unexpected host ${hostname}.`), '');
      return;
    }
    const requestedFamily = options.family === 4 || options.family === 'IPv4'
      ? 4
      : options.family === 6 || options.family === 'IPv6'
        ? 6
        : undefined;
    const candidates = requestedFamily === undefined
      ? [...addresses]
      : addresses.filter((entry) => entry.family === requestedFamily);
    const selected = candidates[0];
    if (selected === undefined) {
      callback(new Error(`No validated address matches DNS family ${String(options.family)}.`), '');
      return;
    }
    if (options.all) {
      callback(null, candidates);
      return;
    }
    callback(null, selected.address, selected.family);
  }) as NonNullable<AxiosRequestConfig['lookup']>;
}

function isAxiosTransport(http: object): boolean {
  return 'defaults' in http && 'interceptors' in http;
}

function assertRedirectOrigin(from: URL, to: URL, policy: NetworkPolicy): void {
  if (!policy.allowCrossOriginRedirects && from.origin !== to.origin) {
    throw new Error(
      `${policy.name} network policy rejected cross-origin redirect from ${from.origin} to ${to.origin}.`,
    );
  }
}

/**
 * Axios GET with explicit per-hop validation. Redirect following is performed
 * here (not delegated to follow-redirects), so every Location and the reported
 * final URL crosses the same scheme/host/path/DNS boundary.
 */
export async function safeAxiosGet<T>(
  http: Pick<AxiosInstance, 'get'>,
  rawUrl: string,
  policy: NetworkPolicy,
  config: AxiosRequestConfig = {},
  options: SafeRequestOptions = {},
): Promise<AxiosResponse<T>> {
  config = boundedAxiosConfig(config);
  const resolveDns = options.resolveDns ?? isAxiosTransport(http);
  const resolver = options.resolver ?? systemHostResolver;
  const resolutionTimeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS;
  const limit = redirectLimit(config);
  let current = await validateRequestUrl(
    rawUrl,
    policy,
    resolveDns,
    resolver,
    resolutionTimeoutMs,
  );

  for (let hop = 0; hop <= limit; hop++) {
    const response = await http.get<T>(current.url.toString(), {
      ...config,
      maxRedirects: 0,
      proxy: false,
      ...(current.lookup ? { lookup: current.lookup } : {}),
      validateStatus: (status) => requestAcceptsStatus(config, status),
    });
    const location = locationHeader(response);
    if (redirectStatus(response.status) && location) {
      if (hop === limit) throw new Error(`${policy.name} network policy redirect limit exceeded.`);
      const next = await validateRequestUrl(
        new URL(location, current.url).toString(),
        policy,
        resolveDns,
        resolver,
        resolutionTimeoutMs,
      );
      assertRedirectOrigin(current.url, next.url, policy);
      current = next;
      continue;
    }
    if (redirectStatus(response.status)) {
      throw new Error(`${policy.name} network policy rejected a redirect without Location.`);
    }

    const final = responseUrl(response);
    if (final) {
      const validatedFinal = await validateRequestUrl(
        final,
        policy,
        resolveDns,
        resolver,
        resolutionTimeoutMs,
      );
      assertRedirectOrigin(current.url, validatedFinal.url, policy);
    }
    return response;
  }

  throw new Error(`${policy.name} network policy redirect limit exceeded.`);
}

/** POST counterpart to {@link safeAxiosGet}; 301/302/303 become GET. */
export async function safeAxiosPost<T>(
  http: Pick<AxiosInstance, 'get' | 'post'>,
  rawUrl: string,
  data: unknown,
  policy: NetworkPolicy,
  config: AxiosRequestConfig = {},
  options: SafeRequestOptions = {},
): Promise<AxiosResponse<T>> {
  const requestCeiling = Math.min(
    MAX_NETWORK_REQUEST_BYTES,
    Math.max(DEFAULT_NETWORK_REQUEST_BYTES, options.maxRequestBytes ?? 0),
  );
  config = boundedAxiosConfig(config, requestCeiling);
  const resolveDns = options.resolveDns ?? isAxiosTransport(http);
  const resolver = options.resolver ?? systemHostResolver;
  const resolutionTimeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS;
  const limit = redirectLimit(config);
  let current = await validateRequestUrl(
    rawUrl,
    policy,
    resolveDns,
    resolver,
    resolutionTimeoutMs,
  );
  let method: 'GET' | 'POST' = 'POST';

  for (let hop = 0; hop <= limit; hop++) {
    const requestConfig: AxiosRequestConfig = {
      ...config,
      maxRedirects: 0,
      validateStatus: (status) => requestAcceptsStatus(config, status),
    };
    const response = method === 'POST'
      ? await http.post<T>(current.url.toString(), data, {
        ...requestConfig,
        proxy: false,
        ...(current.lookup ? { lookup: current.lookup } : {}),
      })
      : await http.get<T>(current.url.toString(), {
        ...requestConfig,
        proxy: false,
        ...(current.lookup ? { lookup: current.lookup } : {}),
      });
    const location = locationHeader(response);
    if (redirectStatus(response.status) && location) {
      if (hop === limit) throw new Error(`${policy.name} network policy redirect limit exceeded.`);
      const next = await validateRequestUrl(
        new URL(location, current.url).toString(),
        policy,
        resolveDns,
        resolver,
        resolutionTimeoutMs,
      );
      assertRedirectOrigin(current.url, next.url, policy);
      if (response.status === 301 || response.status === 302 || response.status === 303) method = 'GET';
      current = next;
      continue;
    }
    if (redirectStatus(response.status)) {
      throw new Error(`${policy.name} network policy rejected a redirect without Location.`);
    }

    const final = responseUrl(response);
    if (final) {
      const validatedFinal = await validateRequestUrl(
        final,
        policy,
        resolveDns,
        resolver,
        resolutionTimeoutMs,
      );
      assertRedirectOrigin(current.url, validatedFinal.url, policy);
    }
    return response;
  }

  throw new Error(`${policy.name} network policy redirect limit exceeded.`);
}
