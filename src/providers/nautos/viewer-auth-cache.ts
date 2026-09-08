import { AuthenticationError } from '../../shared/errors.js';

export const NAUTOS_MAX_VIEWER_AUTH_BYTES = 16 * 1024;
export const NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES = 128;
export const NAUTOS_MAX_VIEWER_AUTH_CACHE_BYTES = 512 * 1024;
export const NAUTOS_MAX_VIEWER_AUTH_RETENTION_SECONDS = 24 * 60 * 60;
const VIEWER_AUTH_REFRESH_BUFFER_SECONDS = 60;

interface ViewerAuth {
  xSHI: string;
  exp: number;
  bytes: number;
}

/**
 * Bounded in-memory NV viewer credential cache. Authentication-epoch checks
 * are injected so cache state cannot survive a concurrent logout.
 */
export class NautosViewerAuthCache {
  private readonly cache = new Map<string, ViewerAuth>();
  private totalBytes = 0;
  private sweepTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  constructor(
    private readonly entitlementScope: string,
    private readonly assertEpoch: (expectedEpoch: number) => void,
  ) {}

  clear(): void {
    this.cache.clear();
    this.totalBytes = 0;
    if (this.sweepTimer) globalThis.clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  cacheAuth(
    din21Id: string,
    auth: Omit<ViewerAuth, 'bytes'>,
    expectedEpoch: number,
  ): void {
    this.assertEpoch(expectedEpoch);
    this.sweepExpired();
    const key = this.keyFor(din21Id);
    this.delete(key);
    const bytes = Buffer.byteLength(key, 'utf8') + Buffer.byteLength(auth.xSHI, 'utf8');
    if (bytes > NAUTOS_MAX_VIEWER_AUTH_CACHE_BYTES) {
      this.scheduleSweep();
      return;
    }
    this.cache.set(key, { ...auth, bytes });
    this.totalBytes += bytes;
    while (
      this.cache.size > NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES
      || this.totalBytes > NAUTOS_MAX_VIEWER_AUTH_CACHE_BYTES
    ) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.scheduleSweep();
  }

  get(din21Id: string): string | null {
    this.sweepExpired();
    const key = this.keyFor(din21Id);
    const cached = this.cache.get(key);
    if (!cached) {
      this.scheduleSweep();
      return null;
    }
    // Map insertion order is the LRU order. Refresh without retaining another
    // copy of the secret or changing the aggregate byte accounting.
    this.cache.delete(key);
    this.cache.set(key, cached);
    this.scheduleSweep();
    return cached.xSHI;
  }

  parse(token: string): Omit<ViewerAuth, 'bytes'> {
    const tokenBytes = Buffer.byteLength(token, 'utf8');
    if (
      tokenBytes < 16
      || tokenBytes > NAUTOS_MAX_VIEWER_AUTH_BYTES
      || token.trim() !== token
      || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    ) {
      throw new AuthenticationError('Invalid nautos viewer authentication token.');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as unknown;
    } catch {
      throw new AuthenticationError('Invalid nautos viewer authentication token.');
    }
    const exp = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { exp?: unknown }).exp
      : undefined;
    const now = Math.floor(Date.now() / 1_000);
    if (
      typeof exp !== 'number'
      || !Number.isSafeInteger(exp)
      || exp <= now + VIEWER_AUTH_REFRESH_BUFFER_SECONDS
    ) {
      throw new AuthenticationError('Invalid or expired nautos viewer authentication token.');
    }
    return {
      xSHI: token,
      // Even an issuer bug or hostile far-future claim cannot retain this
      // secret indefinitely. The response remains usable, but its cache lease
      // is capped independently of the embedded claim.
      exp: Math.min(exp, now + NAUTOS_MAX_VIEWER_AUTH_RETENTION_SECONDS),
    };
  }

  snapshot(): { entries: number; bytes: number } {
    this.sweepExpired();
    this.scheduleSweep();
    return { entries: this.cache.size, bytes: this.totalBytes };
  }

  private keyFor(din21Id: string): string {
    return `${this.entitlementScope}:${din21Id}`;
  }

  private delete(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cache.delete(key);
    this.totalBytes -= entry.bytes;
  }

  private sweepExpired(nowMs = Date.now()): void {
    for (const [key, entry] of this.cache) {
      if (nowMs >= (entry.exp - VIEWER_AUTH_REFRESH_BUFFER_SECONDS) * 1_000) {
        this.delete(key);
      }
    }
  }

  private scheduleSweep(): void {
    if (this.sweepTimer) globalThis.clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
    let nextSweep = Number.POSITIVE_INFINITY;
    for (const entry of this.cache.values()) {
      nextSweep = Math.min(
        nextSweep,
        (entry.exp - VIEWER_AUTH_REFRESH_BUFFER_SECONDS) * 1_000,
      );
    }
    if (!Number.isFinite(nextSweep)) return;
    const delay = Math.max(1, Math.min(2_147_483_647, nextSweep - Date.now() + 1));
    this.sweepTimer = globalThis.setTimeout(() => {
      this.sweepTimer = undefined;
      this.sweepExpired();
      this.scheduleSweep();
    }, delay);
    this.sweepTimer.unref();
  }
}
