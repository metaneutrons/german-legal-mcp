import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAxios, mockInstance } = vi.hoisted(() => {
  const mockInstance = {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { headers: { common: {} as Record<string, string> } },
  };
  return {
    mockInstance,
    mockAxios: {
      create: vi.fn(() => mockInstance),
      post: vi.fn(),
      get: vi.fn(),
      isAxiosError: (e: unknown): boolean => (e as { isAxiosError?: boolean })?.isAxiosError === true,
    },
  };
});

vi.mock('axios', () => ({ default: mockAxios }));
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));
vi.mock('./config.js', () => ({
  nautosConfig: {
    baseUrl: 'https://nautos.de',
    tenantKey: 'TENANT',
    username: 'u',
    password: 'p',
  },
}));

import {
  clearNautosAuthentication,
  getNautosAuthenticationSnapshot,
  getNautosViewerAuthCacheSnapshot,
  NAUTOS_MAX_VIEWER_AUTH_BYTES,
  NAUTOS_MAX_VIEWER_AUTH_CACHE_BYTES,
  NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES,
  NAUTOS_MAX_VIEWER_AUTH_RETENTION_SECONDS,
  NautosClient,
} from './client.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jwt(
  exp = Math.floor(Date.now() / 1000) + 3600,
  targetBytes?: number,
): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const prefix = `h.${payload}.`;
  const signature = 's'.repeat(Math.max(1, (targetBytes ?? prefix.length + 1) - prefix.length));
  return `${prefix}${signature}`;
}

function mockViewerChain(token: () => string): void {
  mockInstance.get.mockImplementation(async (url: string) => {
    if (url.includes('/simultaneously/')) return { data: 'LOCK' };
    if (url.includes('/octa/token')) return { data: { octaToken: 'OCTA' } };
    if (url.endsWith('/toc')) return { data: { body: { toc: { section: [] } } } };
    throw new Error(`unexpected get ${url}`);
  });
  mockInstance.post.mockImplementation(async (url: string) => {
    if (url.includes('/auth/user')) return { data: { xSHISecurity: token() } };
    throw new Error(`unexpected post ${url}`);
  });
}

type PinnedLookup = (
  hostname: string,
  options: { all?: boolean; family?: number | string },
  callback: (error: Error | null, address: string | Array<{ address: string; family: number }>) => void,
) => void;

function lookupAddress(lookup: PinnedLookup, hostname = 'nautos.de'): Promise<string> {
  return new Promise((resolve, reject) => {
    lookup(hostname, {}, (error, address) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(typeof address === 'string' ? address : address[0]?.address ?? '');
    });
  });
}

beforeEach(() => {
  clearNautosAuthentication();
  mockInstance.get.mockReset();
  mockInstance.post.mockReset();
  mockAxios.post.mockReset();
  // IP-based login (module axios.post) yields a JWT session.
  mockAxios.post.mockResolvedValue({ data: { token: jwt(), userAccountId: 'acc' } });
});

afterEach(() => {
  clearNautosAuthentication();
  vi.useRealTimers();
});

describe('NautosClient', () => {
  it('fails closed on redirects and ambient proxies and bounds responses', () => {
    new NautosClient();
    expect(mockAxios.create).toHaveBeenLastCalledWith(expect.objectContaining({
      maxRedirects: 0,
      proxy: false,
      maxContentLength: 16 * 1024 * 1024,
    }));
  });

  it('rejects malformed JWT sessions', async () => {
    mockAxios.post.mockResolvedValue({ data: { token: 'not-a-jwt', userAccountId: 'acc' } });
    await expect(new NautosClient().search('DIN 1')).rejects.toThrow(/Invalid nautos JWT/i);
  });

  it('rejects private DNS answers before sending tenant or user credentials', async () => {
    const resolver = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
    await expect(new NautosClient({ resolver }).search('DIN 1')).rejects.toThrow(
      /Authentication failed/i,
    );
    expect(resolver).toHaveBeenCalledTimes(2); // IP auth, then credential fallback
    expect(mockAxios.post).not.toHaveBeenCalled();
    expect(mockInstance.post).not.toHaveBeenCalled();
  });

  it('pins the validated public DNS answer into the socket lookup', async () => {
    const resolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const socketAddresses: string[] = [];
    let pinnedLookup: PinnedLookup | undefined;
    mockAxios.post.mockImplementationOnce(async (
      _url: string,
      _body: unknown,
      config: { lookup?: PinnedLookup },
    ) => {
      pinnedLookup = config.lookup;
      socketAddresses.push(await lookupAddress(config.lookup!));
      socketAddresses.push(await lookupAddress(config.lookup!));
      return { data: { token: jwt(), userAccountId: 'acc' } };
    });
    mockInstance.post.mockResolvedValue({ data: { count: 0, searchResultItems: [] } });

    await expect(new NautosClient({ resolver }).search('DIN 1')).resolves.toEqual({
      count: 0,
      items: [],
    });
    expect(socketAddresses).toEqual(['93.184.216.34', '93.184.216.34']);
    expect(resolver).toHaveBeenCalledTimes(2); // once per HTTP request, never from socket lookup
    await expect(lookupAddress(pinnedLookup!, 'attacker.invalid')).rejects.toThrow(
      /unexpected host/i,
    );
  });

  it('does not follow credential redirects and disables ambient proxies', async () => {
    mockAxios.post.mockResolvedValue({
      status: 302,
      headers: { location: 'https://attacker.invalid/collect' },
      data: {},
    });

    await expect(new NautosClient().search('DIN 1')).rejects.toThrow(/Authentication failed/i);
    expect(mockAxios.post).toHaveBeenCalledTimes(2);
    for (const [url, , config] of mockAxios.post.mock.calls) {
      expect(url).toMatch(/^https:\/\/nautos\.de\/api\/authentication/);
      expect(url).not.toContain('attacker.invalid');
      expect(config).toMatchObject({ maxRedirects: 0, proxy: false });
      expect(config.lookup).toEqual(expect.any(Function));
    }
    expect(mockInstance.get).not.toHaveBeenCalled();
    expect(mockInstance.post).not.toHaveBeenCalled();
  });

  it('keeps JWT and viewer credentials on exact allowed absolute HTTPS endpoints', async () => {
    mockViewerChain(() => jwt());
    await expect(new NautosClient().getToc('D-network')).resolves.toEqual([]);

    expect(mockAxios.post.mock.calls[0]?.[0]).toBe(
      'https://nautos.de/api/authentication/TENANT',
    );
    expect(mockInstance.get.mock.calls.map(([url]: [string]) => url)).toEqual([
      'https://nautos.de/api/v1/documentaccess/simultaneously/D-network',
      'https://nautos.de/api/v1/octa/token',
      'https://nautos.de/api/nv/nv-rest/D-network/toc',
    ]);
    expect(mockInstance.post.mock.calls.map(([url]: [string]) => url)).toEqual([
      'https://nautos.de/api/nv/nv-rest/auth/user',
    ]);

    const requestConfigs = [
      mockAxios.post.mock.calls[0]?.[2],
      ...mockInstance.get.mock.calls.map((call) => call[1]),
      ...mockInstance.post.mock.calls.map((call) => call[2]),
    ];
    for (const config of requestConfigs) {
      expect(config).toMatchObject({ maxRedirects: 0, proxy: false });
      expect(config.lookup).toEqual(expect.any(Function));
    }
    expect(mockInstance.defaults.headers.common.Authorization).toMatch(/^Bearer /);
    expect(mockInstance.get.mock.calls[2]?.[1]?.headers).toMatchObject({
      'X-SHI-SECURITY': expect.any(String),
    });
  });

  it('authenticates then parses search results', async () => {
    mockInstance.post.mockResolvedValueOnce({
      data: {
        count: 1,
        searchResultItems: [{
          id: 'A1', documentNumber: 'DIN 1', titleDe: 'Standard',
          dateOfIssue: '2020', documentType: ['norm'], score: 1,
        }],
      },
    });

    const result = await new NautosClient().search('DIN 1');

    expect(result.count).toBe(1);
    expect(result.items[0]).toMatchObject({ acCode: 'A1', documentNumber: 'DIN 1', title: 'Standard' });
  });

  it('invalidates an in-flight global login and never commits its stale session', async () => {
    const staleLogin = deferred<{ data: { token: string; userAccountId: string } }>();
    const freshLogin = deferred<{ data: { token: string; userAccountId: string } }>();
    const staleToken = `${jwt()}stale`;
    const freshToken = `${jwt()}fresh`;
    mockAxios.post
      .mockImplementationOnce(() => staleLogin.promise)
      .mockImplementationOnce(() => freshLogin.promise);
    mockInstance.post.mockResolvedValue({ data: { count: 0, searchResultItems: [] } });
    const client = new NautosClient();

    const staleRequest = client.search('stale');
    await vi.waitFor(() => expect(mockAxios.post).toHaveBeenCalledTimes(1));
    clearNautosAuthentication();

    const freshRequest = client.search('fresh');
    await vi.waitFor(() => expect(mockAxios.post).toHaveBeenCalledTimes(2));
    staleLogin.resolve({ data: { token: staleToken, userAccountId: 'stale-account' } });
    await expect(staleRequest).rejects.toThrow(/cleared while .* in progress/i);

    // The stale operation's finally handler must not detach the replacement.
    const sharedFreshRequest = client.search('also-fresh');
    await Promise.resolve();
    expect(mockAxios.post).toHaveBeenCalledTimes(2);
    freshLogin.resolve({ data: { token: freshToken, userAccountId: 'fresh-account' } });
    await expect(Promise.all([freshRequest, sharedFreshRequest])).resolves.toEqual([
      { count: 0, items: [] },
      { count: 0, items: [] },
    ]);

    expect(mockInstance.defaults.headers.common.Authorization).toBe(`Bearer ${freshToken}`);
    expect(getNautosAuthenticationSnapshot().authenticated).toBe(true);
  });

  it('fetches document detail with viewer access metadata', async () => {
    mockInstance.get.mockResolvedValueOnce({
      data: { id: 'A1', documentNumber: 'DIN 1', titleDe: 'Standard', valid: true, documentType: ['norm'], classificationIcs: [] },
    });
    mockInstance.post.mockResolvedValueOnce({ data: [{ fulltexts: [{ din21Id: 'D1', format: 'pdf' }] }] });

    const detail = await new NautosClient().getDetail('A1');

    expect(detail).toMatchObject({ acCode: 'A1', documentNumber: 'DIN 1', din21Id: 'D1', format: 'pdf' });
  });

  it('wraps an API error', async () => {
    mockInstance.post.mockRejectedValueOnce(new Error('boom'));
    await expect(new NautosClient().search('x')).rejects.toThrow('boom');
  });

  it('runs the NV viewer auth chain, normalizes the TOC and caches the auth', async () => {
    mockInstance.get.mockImplementation(async (url: string) => {
      if (url.includes('/simultaneously/')) return { data: '"LOCK-1"' };
      if (url.includes('/octa/token')) return { data: { octaToken: 'OCTA' } };
      if (url.endsWith('/toc')) return {
        data: { body: { toc: { section: [
          { id: 's1', label: '1', title: 'Scope\nand purpose', section: { id: 's1.1', title: 'Sub' } },
          { title: 'No id section' },
        ] } } },
      };
      throw new Error(`unexpected get ${url}`);
    });
    mockInstance.post.mockImplementation(async (url: string) => {
      if (url.includes('/auth/user')) return { data: { xSHISecurity: jwt() } };
      throw new Error(`unexpected post ${url}`);
    });

    const client = new NautosClient();
    const toc = await client.getToc('D-toc');

    expect(toc).toEqual([
      { id: 's1', label: '1', title: 'Scope and purpose', section: [{ id: 's1.1', title: 'Sub' }] },
      { id: '', title: 'No id section' },
    ]);

    // A second call reuses the cached viewer auth — no second NV auth POST.
    await client.getToc('D-toc');
    const authPosts = mockInstance.post.mock.calls.filter(([u]: [string]) => u.includes('/auth/user'));
    expect(authPosts).toHaveLength(1);
  });

  it('invalidates pending viewer auth on logout and never caches its stale secret', async () => {
    const staleViewerAuth = deferred<{ data: { xSHISecurity: string } }>();
    const freshViewerAuth = deferred<{ data: { xSHISecurity: string } }>();
    const staleToken = `${jwt()}stale`;
    const freshToken = `${jwt()}fresh`;
    let viewerAuthCalls = 0;
    const tocSecurityHeaders: string[] = [];
    mockInstance.get.mockImplementation(async (url: string, options?: {
      headers?: Record<string, string>;
    }) => {
      if (url.includes('/simultaneously/')) return { data: 'LOCK' };
      if (url.includes('/octa/token')) return { data: { octaToken: 'OCTA' } };
      if (url.endsWith('/toc')) {
        tocSecurityHeaders.push(options?.headers?.['X-SHI-SECURITY'] ?? '');
        return { data: { body: { toc: { section: [] } } } };
      }
      throw new Error(`unexpected get ${url}`);
    });
    mockInstance.post.mockImplementation(async (url: string) => {
      if (!url.includes('/auth/user')) throw new Error(`unexpected post ${url}`);
      viewerAuthCalls++;
      if (viewerAuthCalls === 1) return staleViewerAuth.promise;
      if (viewerAuthCalls === 2) return freshViewerAuth.promise;
      throw new Error('unexpected duplicate viewer authentication');
    });
    const client = new NautosClient();

    const staleRequest = client.getToc('D-race');
    await vi.waitFor(() => expect(viewerAuthCalls).toBe(1));
    clearNautosAuthentication();

    const freshRequest = client.getToc('D-race');
    await vi.waitFor(() => expect(viewerAuthCalls).toBe(2));
    staleViewerAuth.resolve({ data: { xSHISecurity: staleToken } });
    await expect(staleRequest).rejects.toThrow(/cleared while .* in progress/i);

    // The stale pending operation must not delete the current epoch's entry.
    const sharedFreshRequest = client.getToc('D-race');
    await Promise.resolve();
    expect(viewerAuthCalls).toBe(2);
    freshViewerAuth.resolve({ data: { xSHISecurity: freshToken } });
    await expect(Promise.all([freshRequest, sharedFreshRequest])).resolves.toEqual([[], []]);

    await expect(client.getToc('D-race')).resolves.toEqual([]);
    expect(viewerAuthCalls).toBe(2);
    expect(tocSecurityHeaders).toEqual([freshToken, freshToken, freshToken]);
    expect(getNautosViewerAuthCacheSnapshot().entries).toBe(1);
  });

  it('fetches a section, accepting a string-form OCTA token', async () => {
    const octaString = `prefix:${'A'.repeat(64)}`;
    mockInstance.get.mockImplementation(async (url: string) => {
      if (url.includes('/simultaneously/')) return { data: 'LOCK-2' };
      if (url.includes('/octa/token')) return { data: octaString };
      if (url.endsWith('/doc')) return { data: { content: '## Section body' } };
      throw new Error(`unexpected get ${url}`);
    });
    mockInstance.post.mockImplementation(async () => ({ data: { xSHISecurity: jwt() } }));

    const section = await new NautosClient().getSection('D-sec', 'sect-1');
    expect(section).toBe('## Section body');
  });

  it('rejects when the OCTA token cannot be extracted', async () => {
    mockInstance.get.mockImplementation(async (url: string) => {
      if (url.includes('/simultaneously/')) return { data: 'LOCK-3' };
      if (url.includes('/octa/token')) return { data: 'no token here' };
      throw new Error(`unexpected get ${url}`);
    });
    await expect(new NautosClient().getToc('D-bad')).rejects.toThrow(/OCTA token/i);
  });

  it('rejects an oversized xSHISecurity response and retains no secret', async () => {
    mockViewerChain(() => jwt(undefined, NAUTOS_MAX_VIEWER_AUTH_BYTES + 1));

    await expect(new NautosClient().getToc('D-oversized')).rejects.toThrow(
      /Invalid nautos viewer authentication token/i,
    );
    expect(getNautosViewerAuthCacheSnapshot()).toEqual({ entries: 0, bytes: 0 });
  });

  it('rejects invalid and expired viewer-auth expiry claims', async () => {
    const now = Math.floor(Date.now() / 1_000);
    mockViewerChain(() => jwt(now + 30));
    const client = new NautosClient();

    await expect(client.getToc('D-expiring')).rejects.toThrow(/expired/i);
    clearNautosAuthentication();
    mockViewerChain(() => {
      const payload = Buffer.from(JSON.stringify({ exp: 'tomorrow' })).toString('base64url');
      return `h.${payload}.signature`;
    });
    await expect(client.getToc('D-invalid-exp')).rejects.toThrow(/expired/i);
    expect(getNautosViewerAuthCacheSnapshot()).toEqual({ entries: 0, bytes: 0 });
  });

  it('bounds viewer-auth entries and refreshes LRU order on a hit', async () => {
    mockViewerChain(() => jwt());
    const client = new NautosClient();

    for (let index = 0; index < NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES; index++) {
      await client.getToc(`D-lru-${index}`);
    }
    const authCalls = () => mockInstance.post.mock.calls
      .filter(([url]: [string]) => url.includes('/auth/user')).length;
    expect(authCalls()).toBe(NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES);

    await client.getToc('D-lru-0'); // refresh the oldest entry
    await client.getToc(`D-lru-${NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES}`);
    await client.getToc('D-lru-0'); // retained because it was refreshed
    expect(authCalls()).toBe(NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES + 1);
    await client.getToc('D-lru-1'); // the true LRU entry was evicted
    expect(authCalls()).toBe(NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES + 2);

    const snapshot = getNautosViewerAuthCacheSnapshot();
    expect(snapshot.entries).toBeLessThanOrEqual(NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES);
    expect(snapshot.bytes).toBeLessThanOrEqual(NAUTOS_MAX_VIEWER_AUTH_CACHE_BYTES);
  });

  it('enforces the aggregate viewer-auth secret byte budget', async () => {
    mockViewerChain(() => jwt(undefined, 15_000));
    const client = new NautosClient();

    for (let index = 0; index < 40; index++) await client.getToc(`D-bytes-${index}`);

    const snapshot = getNautosViewerAuthCacheSnapshot();
    expect(snapshot.entries).toBeLessThan(40);
    expect(snapshot.bytes).toBeLessThanOrEqual(NAUTOS_MAX_VIEWER_AUTH_CACHE_BYTES);
  });

  it('caps far-future expiry and sweeps viewer-auth secrets while idle', async () => {
    vi.useFakeTimers();
    const nowMs = Date.UTC(2030, 0, 1);
    vi.setSystemTime(nowMs);
    clearNautosAuthentication();
    mockAxios.post.mockResolvedValue({
      data: { token: jwt(Math.floor(nowMs / 1_000) + 3_600), userAccountId: 'acc' },
    });
    mockViewerChain(() => jwt(Math.floor(nowMs / 1_000) + 365 * 24 * 60 * 60));

    await new NautosClient().getToc('D-idle-expiry');
    expect(getNautosViewerAuthCacheSnapshot().entries).toBe(1);

    await vi.advanceTimersByTimeAsync(
      (NAUTOS_MAX_VIEWER_AUTH_RETENTION_SECONDS - 60) * 1_000 + 1_000,
    );
    expect(getNautosViewerAuthCacheSnapshot()).toEqual({ entries: 0, bytes: 0 });
  });
});
