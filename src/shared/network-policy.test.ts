import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  assertResolvedUrlAllowed,
  assertOpaqueIdentifier,
  assertUrlAllowed,
  isBlockedAddress,
  safeAxiosGet,
  type NetworkPolicy,
} from './network-policy.js';

const policy: NetworkPolicy = {
  name: 'test-provider',
  rules: [{
    hostname: 'provider.example',
    paths: [/^\/documents\/[A-Za-z0-9_-]+\.html$/, '/health'],
  }],
};

describe('network policy', () => {
  it('matches literal policy paths exactly without constructing a regular expression', () => {
    expect(assertUrlAllowed('https://provider.example/health', policy).pathname).toBe('/health');
    expect(() => assertUrlAllowed('https://provider.example/health/', policy))
      .toThrow(/rejected path/i);
  });

  it('accepts a legitimate provider HTTPS URL and its fixed path', () => {
    expect(assertUrlAllowed('https://provider.example/documents/A_1.html', policy).hostname)
      .toBe('provider.example');
  });

  it('rejects path traversal and URL syntax in opaque provider identifiers', () => {
    expect(assertOpaqueIdentifier('DOC_123-abc', 'doc_id')).toBe('DOC_123-abc');
    for (const value of ['../secret', 'https://127.0.0.1/', 'doc?id=1', 'a/b']) {
      expect(() => assertOpaqueIdentifier(value, 'doc_id')).toThrow(/opaque identifier/);
    }
  });

  it.each([
    'http://provider.example/documents/A_1.html',
    'https://user:secret@provider.example/documents/A_1.html',
    'https://provider.example/private',
    'https://localhost/documents/A_1.html',
    'https://127.0.0.1/documents/A_1.html',
    'https://[::1]/documents/A_1.html',
    'https://provider.example/documents/%2e%2e/private',
    String.raw`https:\\provider.example\documents\A_1.html`,
  ])('rejects unsafe URL %s', (url) => {
    expect(() => assertUrlAllowed(url, policy)).toThrow(/network policy rejected|requires HTTPS/);
  });

  it.each([
    '10.0.0.1',
    '172.16.12.1',
    '192.168.1.1',
    '169.254.169.254',
    '127.0.0.1',
    '224.0.0.1',
    '::1',
    '::127.0.0.1',
    '::10.0.0.1',
    'fe80::1',
    'fec0::1',
    'fc00::1',
    'ff02::1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::1',
    '2001::1',
    '2001:20::1',
    '2001:2::1',
    '2002:7f00:1::1',
    '3ffe::1',
    '3fff::1',
    '5f00::1',
    '100::1',
    '100:0:0:1::1',
    '192.88.99.1',
    '2000::1',
    '2d00::1',
    '3000::1',
    '::ffff:192.168.1.1',
    '::ffff:169.254.169.254',
    '::ffff:224.0.0.1',
  ])('classifies non-public address %s as blocked', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '64:ff9b::5db8:d822',
    '64:ff9b::93.184.216.34',
    '64:ff9b:0:0:0:0:5db8:d822',
    '2606:4700:4700::1111',
  ])('classifies public destination %s as allowed', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it.each([
    '64:ff9b::a00:1',
    '64:ff9b::7f00:1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::c0a8:101',
    '64:ff9b::192.168.1.1',
    '64:ff9b::e000:1',
  ])('rejects NAT64 when its embedded IPv4 destination %s is not public', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it('rejects an allowlisted hostname when DNS resolves to RFC1918 space', async () => {
    await expect(assertResolvedUrlAllowed(
      'https://provider.example/documents/A_1.html',
      policy,
      async () => [{ address: '192.168.12.5', family: 4 }],
    )).rejects.toThrow(/non-public address/);
  });

  it('rejects an allowlisted hostname when DNS resolves to cloud link-local metadata', async () => {
    await expect(assertResolvedUrlAllowed(
      'https://provider.example/documents/A_1.html',
      policy,
      async () => [{ address: '169.254.169.254', family: 4 }],
    )).rejects.toThrow(/non-public address/);
  });

  it('accepts well-known NAT64 only for an embedded public IPv4 destination', async () => {
    await expect(assertResolvedUrlAllowed(
      'https://provider.example/documents/A_1.html',
      policy,
      async () => [{ address: '64:ff9b::5db8:d822', family: 6 }],
    )).resolves.toBeInstanceOf(URL);
  });

  it('bounds DNS resolution before dispatching a request', async () => {
    const get = vi.fn();
    await expect(safeAxiosGet(
      { get } as unknown as Pick<AxiosInstance, 'get'>,
      'https://provider.example/documents/A_1.html',
      policy,
      { timeout: 10 },
      {
        resolveDns: true,
        resolver: () => new Promise(() => undefined),
      },
    )).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });
    expect(get).not.toHaveBeenCalled();
  });

  it('pins each request to the validated DNS answer and disables ambient proxies', async () => {
    const get = vi.fn(async (_url: string, config: AxiosRequestConfig) => {
      expect(config.proxy).toBe(false);
      expect(config.timeout).toBe(30_000);
      expect(config.maxContentLength).toBe(64 * 1024 * 1024);
      expect(config.maxBodyLength).toBe(8 * 1024 * 1024);
      const lookup = config.lookup as unknown as (
        hostname: string,
        options: { all?: boolean },
        callback: (
          error: Error | null,
          address: string | { address: string; family: number }[],
          family?: number,
        ) => void,
      ) => void;
      await new Promise<void>((resolve, reject) => {
        lookup('provider.example', {}, (error, address, family) => {
          if (error) reject(error);
          else {
            expect(address).toBe('93.184.216.34');
            expect(family).toBe(4);
            resolve();
          }
        });
      });
      return { data: 'ok', status: 200, headers: {} };
    });

    await expect(safeAxiosGet(
      { get } as unknown as Pick<AxiosInstance, 'get'>,
      'https://provider.example/documents/A_1.html',
      policy,
      {},
      {
        resolveDns: true,
        resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      },
    )).resolves.toMatchObject({ data: 'ok' });
  });

  it('clamps infinite or excessive transport resource settings', async () => {
    const get = vi.fn(async (_url: string, config: AxiosRequestConfig) => {
      expect(config.timeout).toBe(120_000);
      expect(config.maxContentLength).toBe(64 * 1024 * 1024);
      expect(config.maxBodyLength).toBe(8 * 1024 * 1024);
      return { data: 'ok', status: 200, headers: {} };
    });
    await safeAxiosGet(
      { get } as unknown as Pick<AxiosInstance, 'get'>,
      'https://provider.example/documents/A_1.html',
      policy,
      { timeout: 999_999, maxContentLength: Infinity, maxBodyLength: Infinity },
    );
  });

  it('validates a redirect hop before issuing the next request', async () => {
    const get = vi.fn(async () => ({
      data: '',
      status: 302,
      headers: { location: 'https://127.0.0.1/internal' },
    }));

    await expect(safeAxiosGet(
      { get } as unknown as Pick<AxiosInstance, 'get'>,
      'https://provider.example/documents/A_1.html',
      policy,
    )).rejects.toThrow(/literal-IP host/);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('rejects a transport-reported unsafe final URL', async () => {
    const get = vi.fn(async () => ({
      data: 'secret',
      status: 200,
      headers: {},
      request: { res: { responseUrl: 'https://169.254.169.254/latest/meta-data/' } },
    }));

    await expect(safeAxiosGet(
      { get } as unknown as Pick<AxiosInstance, 'get'>,
      'https://provider.example/documents/A_1.html',
      policy,
    )).rejects.toThrow(/literal-IP host/);
  });

  it('fails closed on a redirect response without a Location header', async () => {
    const get = vi.fn(async () => ({ data: '', status: 302, headers: {} }));

    await expect(safeAxiosGet(
      { get } as unknown as Pick<AxiosInstance, 'get'>,
      'https://provider.example/documents/A_1.html',
      policy,
    )).rejects.toThrow(/redirect without Location/);
  });
});
