import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockInstance, mockAxios, captured } = vi.hoisted(() => {
  const captured: { fn?: (res: unknown) => unknown } = {};
  const mockInstance = {
    get: vi.fn(),
    interceptors: { response: { use: vi.fn((fn: (res: unknown) => unknown) => { captured.fn = fn; }) } },
  };
  return { mockInstance, mockAxios: { create: vi.fn(() => mockInstance) }, captured };
});
vi.mock('axios', () => ({ default: mockAxios }));

import { DipClient } from './client.js';

beforeEach(() => mockInstance.get.mockReset());

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }] as const;

describe('DipClient', () => {
  it('fails closed on redirects and ambient proxies and bounds responses', async () => {
    mockInstance.get.mockResolvedValue({ data: { numFound: 0, documents: [], cursor: '' } });
    await new DipClient({ resolver: publicResolver }).searchDrucksachen({ q: 'x' });
    expect(mockInstance.get).toHaveBeenLastCalledWith(
      'https://search.dip.bundestag.de/api/v1/drucksache',
      expect.objectContaining({
      maxRedirects: 0,
      proxy: false,
      maxContentLength: 32 * 1024 * 1024,
      params: expect.objectContaining({ q: 'x', apikey: expect.any(String) }),
    }));
  });

  it('returns search results from each endpoint', async () => {
    const result = { numFound: 1, documents: [{ id: '1', titel: 'T', datum: '2025-01-01' }], cursor: 'c' };
    mockInstance.get.mockResolvedValue({ data: result });
    const client = new DipClient({ resolver: publicResolver });

    await expect(client.searchDrucksachen({ q: 'x' })).resolves.toEqual(result);
    await expect(client.searchVorgang({ q: 'x' })).resolves.toEqual(result);
    await expect(client.searchPlenarprotokollText({ q: 'x' })).resolves.toEqual(result);
    expect(mockInstance.get).toHaveBeenCalledWith(
      'https://search.dip.bundestag.de/api/v1/drucksache',
      expect.objectContaining({ params: expect.objectContaining({ q: 'x' }) }),
    );
  });

  it('fetches a single Drucksache by id', async () => {
    mockInstance.get.mockResolvedValue({ data: { id: '42', titel: 'D', datum: '2025-01-01' } });
    await expect(new DipClient({ resolver: publicResolver }).getDrucksache('42'))
      .resolves.toMatchObject({ id: '42' });
  });

  it('rejects a private DNS answer before the API key reaches the transport', async () => {
    const client = new DipClient({
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    await expect(client.searchDrucksachen({ q: 'confidential' }))
      .rejects.toThrow(/non-public address/i);
    expect(mockInstance.get).not.toHaveBeenCalled();
  });

  it('rejects encoded path separators before dispatching a document request', async () => {
    const client = new DipClient({ resolver: publicResolver });

    await expect(client.getDrucksache('../internal'))
      .rejects.toThrow(/encoded path separator/i);
    expect(mockInstance.get).not.toHaveBeenCalled();
  });

  it('raises a clear error when the API returns an Enodia rate-limit challenge', () => {
    new DipClient({ resolver: publicResolver }); // registers the response interceptor
    expect(captured.fn).toBeTypeOf('function');
    expect(() => captured.fn!({ data: '<html>Enodia challenge</html>' }))
      .toThrow(/rate limit/i);
  });

  it('passes through a normal response via the interceptor', () => {
    new DipClient({ resolver: publicResolver });
    const ok = { data: { numFound: 0 } };
    expect(captured.fn!(ok)).toBe(ok);
  });
});
