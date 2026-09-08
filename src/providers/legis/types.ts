export const STATES = [
  'BUND', 'BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH',
] as const;

export type State = (typeof STATES)[number];

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  date: string;
  url?: string;
}

export interface LegisEntry {
  title: string;
  content: string;
  url: string;
}

export interface TocEntry {
  depth: number;
  num: string;
  title: string;
}

export interface LegisEnumerationRequest {
  /**
   * Accepted for interface symmetry; sources that publish no modification
   * stamp ignore it and report `origin: 'unfiltered'` rather than pretending
   * to have filtered.
   */
  since?: string;
  cursor?: string;
  limit?: number;
}

export interface LegisEnumerationPage {
  results: SearchResult[];
  nextCursor?: string;
  origin: 'native' | 'derived' | 'unfiltered';
}

export interface LegisAdapter {
  readonly states: readonly string[];
  search(state: string, query: string, limit: number): Promise<SearchResult[]>;
  get(state: string, id: string): Promise<LegisEntry>;
  toc?(state: string, id: string): Promise<TocEntry[]>;
  /**
   * Walk the state's whole body of legislation. Optional: most Länder portals
   * expose only a search mask, and faking a walk by iterating queries would
   * claim coverage the adapter cannot deliver.
   */
  enumerate?(state: string, request?: LegisEnumerationRequest): Promise<LegisEnumerationPage>;
}
