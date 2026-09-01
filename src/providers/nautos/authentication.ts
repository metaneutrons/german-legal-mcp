import axios from 'axios';
import { nautosConfig } from './config.js';
import { AuthenticationError } from '../../shared/errors.js';
import { nautosEntitlementCacheScope } from './cache-scope.js';
import { NautosViewerAuthCache } from './viewer-auth-cache.js';
import {
  safeAxiosPost,
  type SafeRequestOptions,
} from '../../shared/network-policy.js';
import { NAUTOS_NETWORK_POLICY } from './network-policy.js';

export const NAUTOS_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const NAUTOS_REQUEST_SECURITY = {
  maxRedirects: 0,
  proxy: false as const,
  maxContentLength: NAUTOS_MAX_RESPONSE_BYTES,
  maxBodyLength: 2 * 1024 * 1024,
};
const NAUTOS_ENTITLEMENT_SCOPE = nautosEntitlementCacheScope(nautosConfig);

interface JwtSession {
  token: string;
  exp: number;
  userAccountId: string;
}

let session: JwtSession | null = null;
let authenticationEpoch = 0;
let loginPromise: { epoch: number; promise: Promise<JwtSession> } | null = null;

const viewerAuthCache = new NautosViewerAuthCache(
  NAUTOS_ENTITLEMENT_SCOPE,
  assertAuthenticationEpoch,
);

export function assertAuthenticationEpoch(epoch: number): void {
  if (epoch !== authenticationEpoch) {
    throw new AuthenticationError(
      'nautos: Authentication was cleared while an authentication operation was in progress.',
    );
  }
}

export function getNautosAuthenticationEpoch(): number {
  return authenticationEpoch;
}

function invalidateAuthentication(): void {
  authenticationEpoch++;
  session = null;
  // Detach in-flight work immediately. Its epoch checks keep it from
  // committing after logout, and identity-checked finally handlers cannot
  // clear a replacement operation from the new epoch.
  loginPromise = null;
  viewerAuthCache.clear();
}

export interface NautosAuthenticationSnapshot {
  readonly authenticated: boolean;
  readonly expiresAt?: number;
}

export function getNautosAuthenticationSnapshot(): NautosAuthenticationSnapshot {
  if (!session || isExpired()) return { authenticated: false };
  return { authenticated: true, expiresAt: session.exp };
}

export async function refreshNautosAuthentication(): Promise<NautosAuthenticationSnapshot> {
  invalidateAuthentication();
  const refreshed = await login();
  return { authenticated: true, expiresAt: refreshed.exp };
}

export function clearNautosAuthentication(): void {
  invalidateAuthentication();
}

function isExpired(): boolean {
  if (!session) return true;
  return Date.now() / 1000 > session.exp - 300; // 5min buffer
}

function parseSession(data: Record<string, unknown>): JwtSession {
  const token = data.token;
  if (typeof token !== 'string' || token.length < 16 || token.length > 16_384) {
    throw new AuthenticationError('Invalid nautos JWT.');
  }
  const encodedPayload = token.split('.')[1];
  if (encodedPayload === undefined) throw new AuthenticationError('Invalid nautos JWT.');
  let payload: { exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()) as { exp?: unknown };
  } catch {
    throw new AuthenticationError('Invalid nautos JWT.');
  }
  const exp = Number(payload.exp);
  if (!Number.isSafeInteger(exp) || exp <= Date.now() / 1000) {
    throw new AuthenticationError('Invalid or expired nautos JWT.');
  }
  const userAccountId = typeof data.userAccountId === 'string' ? data.userAccountId : '';
  return { token, exp, userAccountId };
}

function storeAuthenticationResponse(
  data: Record<string, unknown>,
  expectedEpoch: number,
): JwtSession | null {
  if (!data.token) return null;
  const candidate = parseSession(data);
  assertAuthenticationEpoch(expectedEpoch);
  session = candidate;
  return candidate;
}

async function requestAuthentication(
  url: string,
  payload: Record<string, unknown>,
  expectedEpoch: number,
  networkOptions: SafeRequestOptions,
): Promise<JwtSession | null> {
  try {
    const { data } = await safeAxiosPost<Record<string, unknown>>(
      axios,
      url,
      payload,
      NAUTOS_NETWORK_POLICY,
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000, ...NAUTOS_REQUEST_SECURITY },
      networkOptions,
    );
    assertAuthenticationEpoch(expectedEpoch);
    return storeAuthenticationResponse(data, expectedEpoch);
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    assertAuthenticationEpoch(expectedEpoch);
    return null;
  }
}

async function authenticateWithTenantKey(
  base: string,
  expectedEpoch: number,
  networkOptions: SafeRequestOptions,
): Promise<JwtSession | null> {
  if (!nautosConfig.tenantKey) return null;
  return requestAuthentication(
    `${base}/${encodeURIComponent(nautosConfig.tenantKey)}`,
    {},
    expectedEpoch,
    networkOptions,
  );
}

async function authenticateWithCredentials(
  base: string,
  expectedEpoch: number,
  networkOptions: SafeRequestOptions,
): Promise<JwtSession | null> {
  if (!nautosConfig.username || !nautosConfig.password) return null;
  return requestAuthentication(
    base,
    {
      username: nautosConfig.username,
      password: nautosConfig.password,
      tenantName: nautosConfig.tenantKey,
    },
    expectedEpoch,
    networkOptions,
  );
}

function missingAuthenticationConfiguration(): AuthenticationError {
  const hints = [];
  if (!nautosConfig.tenantKey) hints.push('GLMCP_NAUTOS_TENANT_KEY is required');
  if (!nautosConfig.username) hints.push('set GLMCP_NAUTOS_USERNAME and GLMCP_NAUTOS_PASSWORD for user-based login');
  return new AuthenticationError(
    `nautos: Authentication failed. ${hints.length ? hints.join('; ') + '.' : 'Check your IP range and credentials.'}`,
  );
}

export async function login(
  expectedEpoch = authenticationEpoch,
  networkOptions: SafeRequestOptions = { resolveDns: true },
): Promise<JwtSession> {
  assertAuthenticationEpoch(expectedEpoch);
  if (!isExpired()) return session!;
  if (loginPromise?.epoch === expectedEpoch) {
    const result = await loginPromise.promise;
    assertAuthenticationEpoch(expectedEpoch);
    return result;
  }

  const promise = (async () => {
    const base = `${nautosConfig.baseUrl}/api/authentication`;
    const tenantSession = await authenticateWithTenantKey(base, expectedEpoch, networkOptions);
    if (tenantSession) return tenantSession;
    const credentialSession = await authenticateWithCredentials(base, expectedEpoch, networkOptions);
    if (credentialSession) return credentialSession;
    assertAuthenticationEpoch(expectedEpoch);
    throw missingAuthenticationConfiguration();
  })().finally(() => {
    if (loginPromise?.promise === promise) loginPromise = null;
  });
  loginPromise = { epoch: expectedEpoch, promise };

  const result = await promise;
  assertAuthenticationEpoch(expectedEpoch);
  return result;
}

export function cacheViewerAuth(
  din21Id: string,
  token: string,
  expectedEpoch: number,
): void {
  viewerAuthCache.cacheAuth(din21Id, viewerAuthCache.parse(token), expectedEpoch);
}

export function getCachedViewerAuth(din21Id: string): string | null {
  return viewerAuthCache.get(din21Id);
}

/** Non-secret diagnostics used by health checks and resource-bound tests. */
export function getNautosViewerAuthCacheSnapshot(): { entries: number; bytes: number } {
  return viewerAuthCache.snapshot();
}
