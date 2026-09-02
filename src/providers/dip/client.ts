import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { dipConfig } from './config.js';
import {
  safeAxiosGet,
  systemHostResolver,
  type HostResolver,
} from '../../shared/network-policy.js';
import { DIP_API_POLICY } from './network-policy.js';

const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

class DipRateLimitError extends Error {
  constructor() {
    super('DIP API rate limit exceeded (Enodia challenge). Wait a few minutes and try again.');
    this.name = 'DipRateLimitError';
  }
}

function checkRateLimit(res: AxiosResponse): void {
  if (typeof res.data === 'string' && res.data.includes('Enodia')) {
    throw new DipRateLimitError();
  }
}

export interface DipSearchResult {
  numFound: number;
  documents: DipDocument[];
  cursor: string;
}

export interface DipDocument {
  id: string;
  titel: string;
  datum: string;
  dokumentnummer?: string;
  drucksachetyp?: string;
  dokumentart?: string;
  wahlperiode?: number;
  herausgeber?: string;
  aktualisiert?: string;
  text?: string;
  fundstelle?: {
    pdf_url?: string;
    dokumentnummer?: string;
    datum?: string;
    herausgeber?: string;
    urheber?: string[];
  };
  urheber?: Array<{ bezeichnung: string; titel: string }>;
  ressort?: Array<{ federfuehrend: boolean; titel: string }>;
  vorgangsbezug?: Array<{ id: string; titel: string; vorgangstyp: string }>;
  // Vorgang-specific
  beratungsstand?: string;
  vorgangstyp?: string;
  deskriptor?: Array<{ name: string; typ: string }>;
}

export interface DipClientOptions {
  /** Test seam; production always uses the system resolver and pins its answers. */
  readonly resolver?: HostResolver;
}

export class DipClient {
  private readonly http: AxiosInstance;
  private readonly resolver: HostResolver;

  constructor(options: DipClientOptions = {}) {
    this.resolver = options.resolver ?? systemHostResolver;
    this.http = axios.create();
    this.http.interceptors.response.use(res => { checkRateLimit(res); return res; });
  }

  async searchDrucksachen(params: Record<string, string | number>): Promise<DipSearchResult> {
    const { data } = await this.get<DipSearchResult>('/drucksache', params);
    return data;
  }

  async searchDrucksachenText(params: Record<string, string | number>): Promise<DipSearchResult> {
    const { data } = await this.get<DipSearchResult>('/drucksache-text', params);
    return data;
  }

  async searchVorgang(params: Record<string, string | number>): Promise<DipSearchResult> {
    const { data } = await this.get<DipSearchResult>('/vorgang', params);
    return data;
  }

  async searchPlenarprotokollText(params: Record<string, string | number>): Promise<DipSearchResult> {
    const { data } = await this.get<DipSearchResult>('/plenarprotokoll-text', params);
    return data;
  }

  async getDrucksache(id: string): Promise<DipDocument | null> {
    const { data } = await this.get<DipDocument>(`/drucksache/${encodeURIComponent(id)}`);
    return data;
  }

  private get<T>(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<AxiosResponse<T>> {
    return safeAxiosGet<T>(
      this.http,
      `${dipConfig.baseUrl}${path}`,
      DIP_API_POLICY,
      {
        params: { ...params, apikey: dipConfig.apiKey },
        timeout: 30_000,
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: 1024 * 1024,
      },
      {
        resolveDns: true,
        resolver: this.resolver,
      },
    );
  }
}
