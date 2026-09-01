import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { nautosConfig } from './config.js';
import { wrapAxiosError } from '../../shared/errors.js';
import {
  safeAxiosGet,
  safeAxiosPost,
  type HostResolver,
  type SafeRequestOptions,
} from '../../shared/network-policy.js';
import { NAUTOS_NETWORK_POLICY } from './network-policy.js';
import {
  assertAuthenticationEpoch,
  cacheViewerAuth,
  getCachedViewerAuth,
  getNautosAuthenticationEpoch,
  login,
  NAUTOS_REQUEST_SECURITY,
} from './authentication.js';
import { extractOctaToken } from './octa-token.js';

export {
  clearNautosAuthentication,
  getNautosAuthenticationSnapshot,
  getNautosViewerAuthCacheSnapshot,
  NAUTOS_MAX_RESPONSE_BYTES,
  refreshNautosAuthentication,
  type NautosAuthenticationSnapshot,
} from './authentication.js';

/** Hard transport and structural ceilings for untrusted nautos payloads. */
export const NAUTOS_MAX_TOC_DEPTH = 16;
export const NAUTOS_MAX_TOC_NODES = 2_000;
export {
  NAUTOS_MAX_VIEWER_AUTH_BYTES,
  NAUTOS_MAX_VIEWER_AUTH_CACHE_BYTES,
  NAUTOS_MAX_VIEWER_AUTH_CACHE_ENTRIES,
  NAUTOS_MAX_VIEWER_AUTH_RETENTION_SECONDS,
} from './viewer-auth-cache.js';
// --- Types ---

export interface SearchResult {
  acCode: string;
  documentNumber: string;
  title: string;
  titleEn?: string;
  dateOfIssue: string;
  documentType: string[];
  score: number;
}

export interface DocumentDetail {
  acCode: string;
  documentNumber: string;
  titleDe: string;
  titleEn: string;
  dateOfIssue: string;
  valid: boolean;
  documentType: string[];
  classificationIcs: string[];
  din21Id?: string;
  format?: string;
}

export interface TocSection {
  id: string;
  label?: string;
  title: string;
  section?: TocSection[];
}

/** Normalize a bounded TOC — the API may return one object or an array. */
export function normalizeSections(
  raw: unknown,
  budget: { nodes: number } = { nodes: 0 },
  depth = 0,
): TocSection[] {
  if (!raw) return [];
  if (depth > NAUTOS_MAX_TOC_DEPTH) {
    throw new RangeError(`nautos TOC exceeds maximum depth ${NAUTOS_MAX_TOC_DEPTH}`);
  }
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((value: unknown) => {
    budget.nodes++;
    if (budget.nodes > NAUTOS_MAX_TOC_NODES) {
      throw new RangeError(`nautos TOC exceeds maximum node count ${NAUTOS_MAX_TOC_NODES}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('nautos TOC contains a non-object section');
    }
    const s = value as Record<string, unknown>;
    const label = typeof s.label === 'string' ? s.label : undefined;
    return {
      id: typeof s.id === 'string' ? s.id : '',
      ...(label === undefined ? {} : { label }),
      title: (typeof s.title === 'string' ? s.title : '').replace(/\n/g, ' '),
      ...(s.section ? { section: normalizeSections(s.section, budget, depth + 1) } : {}),
    };
  });
}

// --- Client ---

export class NautosClient {
  private readonly networkOptions: SafeRequestOptions;

  constructor(options: { resolver?: HostResolver } = {}) {
    this.networkOptions = {
      resolveDns: true,
      ...(options.resolver ? { resolver: options.resolver } : {}),
    };
  }

  private apiClient = axios.create({
    baseURL: `${nautosConfig.baseUrl}/api/v1`,
    timeout: 30000,
    ...NAUTOS_REQUEST_SECURITY,
  });

  private async api(expectedEpoch = getNautosAuthenticationEpoch()): Promise<AxiosInstance> {
    assertAuthenticationEpoch(expectedEpoch);
    const s = await login(expectedEpoch, this.networkOptions);
    assertAuthenticationEpoch(expectedEpoch);
    this.apiClient.defaults.headers.common['Authorization'] = `Bearer ${s.token}`;
    return this.apiClient;
  }

  private nv = axios.create({
    baseURL: `${nautosConfig.baseUrl}/api/nv/nv-rest`,
    timeout: 30000,
    ...NAUTOS_REQUEST_SECURITY,
  });

  private async apiGet<T>(
    path: string,
    config: AxiosRequestConfig = {},
    expectedEpoch = getNautosAuthenticationEpoch(),
  ): Promise<AxiosResponse<T>> {
    const client = await this.api(expectedEpoch);
    return safeAxiosGet<T>(
      client,
      `${nautosConfig.baseUrl}/api/v1${path}`,
      NAUTOS_NETWORK_POLICY,
      { ...config, ...NAUTOS_REQUEST_SECURITY },
      this.networkOptions,
    );
  }

  private async apiPost<T>(
    path: string,
    data: unknown,
    config: AxiosRequestConfig = {},
    expectedEpoch = getNautosAuthenticationEpoch(),
  ): Promise<AxiosResponse<T>> {
    const client = await this.api(expectedEpoch);
    return safeAxiosPost<T>(
      client,
      `${nautosConfig.baseUrl}/api/v1${path}`,
      data,
      NAUTOS_NETWORK_POLICY,
      { ...config, ...NAUTOS_REQUEST_SECURITY },
      this.networkOptions,
    );
  }

  private nvGet<T>(path: string, config: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
    return safeAxiosGet<T>(
      this.nv,
      `${nautosConfig.baseUrl}/api/nv/nv-rest${path}`,
      NAUTOS_NETWORK_POLICY,
      { ...config, ...NAUTOS_REQUEST_SECURITY },
      this.networkOptions,
    );
  }

  private nvPost<T>(
    path: string,
    data: unknown,
    config: AxiosRequestConfig = {},
  ): Promise<AxiosResponse<T>> {
    return safeAxiosPost<T>(
      this.nv,
      `${nautosConfig.baseUrl}/api/nv/nv-rest${path}`,
      data,
      NAUTOS_NETWORK_POLICY,
      { ...config, ...NAUTOS_REQUEST_SECURITY },
      this.networkOptions,
    );
  }

  // --- Search & Metadata ---

  async search(documentNr: string, pageSize = 25): Promise<{ count: number; items: SearchResult[] }> {
    try {
      const { data } = await this.apiPost<{
        count?: number;
        searchResultItems?: Record<string, unknown>[];
      }>(
        '/search',
        { documentNr, useDynamicSearch: false },
        { params: { pageSize, pageNumber: 0, sortField: '', sortDir: '' } },
      );
      return {
        count: data.count ?? 0,
        items: (data.searchResultItems ?? []).map((r: Record<string, unknown>) => {
          const titleEn = typeof r.titleEn === 'string' ? r.titleEn : undefined;
          return {
            acCode: r.id as string,
            documentNumber: r.documentNumber as string,
            title: (r.titleDe || r.title) as string,
            ...(titleEn === undefined ? {} : { titleEn }),
            dateOfIssue: r.dateOfIssue as string,
            documentType: r.documentType as string[],
            score: r.score as number,
          };
        }),
      };
    } catch (e) { throw wrapAxiosError(e) ?? e; }
  }

  async getDetail(acCode: string): Promise<DocumentDetail> {
    try {
      const { data } = await this.apiGet<Partial<{
        id: string;
        documentNumber: string;
        titleDe: string;
        titleEn: string;
        dateOfIssue: string;
        valid: boolean;
        documentType: string[];
        classificationIcs: string[];
      }>>(
        `/detail/${encodeURIComponent(acCode)}`,
      );
      let din21Id: string | undefined;
      let format: string | undefined;
      try {
        const s = await login(getNautosAuthenticationEpoch(), this.networkOptions);
        const { data: access } = await this.apiPost<Array<{
          fulltexts?: Array<{ din21Id?: string; format?: string }>;
        }>>('/documentaccess', { userId: s.userAccountId, acCodes: [acCode] });
        const ft = access?.[0]?.fulltexts?.[0];
        if (ft) { din21Id = ft.din21Id; format = ft.format; }
      } catch { /* non-fatal */ }
      return {
        acCode: data.id ?? acCode, documentNumber: data.documentNumber ?? '',
        titleDe: data.titleDe ?? '', titleEn: data.titleEn ?? '',
        dateOfIssue: data.dateOfIssue ?? '', valid: data.valid ?? false,
        documentType: data.documentType ?? [], classificationIcs: data.classificationIcs ?? [],
        ...(din21Id === undefined ? {} : { din21Id }),
        ...(format === undefined ? {} : { format }),
      };
    } catch (e) { throw wrapAxiosError(e) ?? e; }
  }

  // --- NV Viewer Auth Chain ---

  private authPending = new Map<string, { epoch: number; promise: Promise<string> }>();

  private async authenticate(
    din21Id: string,
    epoch = getNautosAuthenticationEpoch(),
  ): Promise<string> {
    assertAuthenticationEpoch(epoch);
    const cached = getCachedViewerAuth(din21Id);
    if (cached) {
      assertAuthenticationEpoch(epoch);
      return cached;
    }
    // Serialize concurrent auth for same din21Id
    const pending = this.authPending.get(din21Id);
    if (pending && pending.epoch === epoch) {
      const result = await pending.promise;
      assertAuthenticationEpoch(epoch);
      return result;
    }
    const promise = this.doAuthenticate(din21Id, epoch).finally(() => {
      if (this.authPending.get(din21Id)?.promise === promise) {
        this.authPending.delete(din21Id);
      }
    });
    this.authPending.set(din21Id, { epoch, promise });
    const result = await promise;
    assertAuthenticationEpoch(epoch);
    return result;
  }

  private async doAuthenticate(din21Id: string, expectedEpoch: number): Promise<string> {
    try {
      const octaToken = await this.requestOctaToken(din21Id, expectedEpoch);
      const xSHI = await this.requestViewerSecurityToken(octaToken, expectedEpoch);
      cacheViewerAuth(din21Id, xSHI, expectedEpoch);
      assertAuthenticationEpoch(expectedEpoch);
      return xSHI;
    } catch (e) {
      assertAuthenticationEpoch(expectedEpoch);
      throw wrapAxiosError(e) ?? e;
    }
  }

  private async requestOctaToken(din21Id: string, expectedEpoch: number): Promise<string> {
    const { data: lockRaw } = await this.apiGet<unknown>(
      `/documentaccess/simultaneously/${encodeURIComponent(din21Id)}`,
      {},
      expectedEpoch,
    );
    assertAuthenticationEpoch(expectedEpoch);
    const { data: octaRaw } = await this.apiGet<unknown>('/octa/token', {
      params: { din21id: din21Id, lockId: String(lockRaw).replaceAll('"', '') },
    }, expectedEpoch);
    assertAuthenticationEpoch(expectedEpoch);
    const token = extractOctaToken(octaRaw);
    if (!token) throw new Error('Invalid OCTA token response format');
    return token;
  }

  private async requestViewerSecurityToken(
    octaToken: string,
    expectedEpoch: number,
  ): Promise<string> {
    const { data } = await this.nvPost<{ xSHISecurity?: unknown }>('/auth/user', {
      isFullscreen: false,
      token: octaToken,
      subuser: '',
      contextid: 'octa',
      lang: 'de',
      url: `${nautosConfig.baseUrl}/api/nv/nv-rest/`,
    });
    assertAuthenticationEpoch(expectedEpoch);
    if (typeof data.xSHISecurity !== 'string') {
      throw new Error('No xSHISecurity in NV auth response');
    }
    return data.xSHISecurity;
  }

  // --- Document Content ---

  async getToc(din21Id: string): Promise<TocSection[]> {
    const epoch = getNautosAuthenticationEpoch();
    const xSHI = await this.authenticate(din21Id, epoch);
    assertAuthenticationEpoch(epoch);
    try {
      const { data } = await this.nvGet<{
        body?: { toc?: { section?: unknown } };
      }>(`/${encodeURIComponent(din21Id)}/toc`, {
        params: { lang: 'de' }, headers: { 'X-SHI-SECURITY': xSHI },
      });
      assertAuthenticationEpoch(epoch);
      return normalizeSections(data?.body?.toc?.section);
    } catch (e) {
      assertAuthenticationEpoch(epoch);
      throw wrapAxiosError(e) ?? e;
    }
  }

  async getSection(din21Id: string, sectionId: string): Promise<string> {
    const epoch = getNautosAuthenticationEpoch();
    const xSHI = await this.authenticate(din21Id, epoch);
    assertAuthenticationEpoch(epoch);
    try {
      const { data } = await this.nvGet<{ content?: string }>(`/${encodeURIComponent(din21Id)}/doc`, {
        params: { los: false, onlyBody: true, sectId: sectionId, lang: 'de', resolution: 2, unit: 'mm', marginalia: true },
        headers: { 'X-SHI-SECURITY': xSHI },
      });
      assertAuthenticationEpoch(epoch);
      return data?.content ?? '';
    } catch (e) {
      assertAuthenticationEpoch(epoch);
      throw wrapAxiosError(e) ?? e;
    }
  }
}
