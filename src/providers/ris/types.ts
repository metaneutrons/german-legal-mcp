/**
 * Types for the Austrian RIS OGD API (data.bka.gv.at/ris/api/v2.6).
 *
 * The API returns JSON-ified XML: elements that occur once are serialised as an
 * object, and only collapse to an array when they repeat. Every list access
 * therefore goes through `toArray` to normalise the single-vs-many ambiguity.
 */

/** Broad RIS federal/state legislation collections plus the case-law collection. */
export type RisApplication = 'bundesrecht' | 'landesrecht' | 'judikatur';

/** Result ordering. `date` = newest first (server-side sort by Datum, descending). */
export type RisSort = 'relevance' | 'date';

/** Normalise the OGD single-object / array ambiguity into a plain array. */
export function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** A linked Entscheidungstext (the full decision behind a Rechtssatz). */
export interface RisDecisionRef {
  id: string;
  date?: string | undefined;
  geschaeftszahl?: string | undefined;
}

/** A flattened search hit, provider-facing. */
export interface RisSearchHit {
  /** Dokumentnummer (Metadaten.Technisch.ID). */
  id: string;
  /** RIS applikation folder, e.g. "Justiz", "BrKons", "BgblAuth". */
  applikation: string;
  title: string;
  /** Court / issuing organ (Metadaten.Technisch.Organ). */
  organ?: string | undefined;
  /** Decision date, Judikatur only. */
  date?: string | undefined;
  /** Court file number(s), Judikatur only. */
  fileNumber?: string | undefined;
  ecli?: string | undefined;
  /** European Legislation Identifier, consolidated law only. */
  eli?: string | undefined;
  validFrom?: string | undefined;
  validTo?: string | undefined;
  publicationDate?: string | undefined;
  /** Austrian Bundesland, for Landesrecht hits (Metadaten.Landesrecht.Bundesland). */
  bundesland?: string | undefined;
  /** Canonical human/permalink URL (Metadaten.Allgemein.DokumentUrl). */
  documentUrl?: string | undefined;
  /** Direct HTML content URL of the main document, for `ris_get`. */
  contentUrl?: string | undefined;
  /** For a Rechtssatz: the full decision texts it derives from, newest first. */
  decisionTexts?: RisDecisionRef[] | undefined;
}

export interface RisSearchResult {
  total: number;
  page: number;
  hits: RisSearchHit[];
}

// --- Raw OGD response shapes (loose; single elements collapse to objects) ------

export interface OgdContentUrl {
  DataType?: string;
  Url?: string;
}

export interface OgdContentReference {
  ContentType?: string;
  Name?: string;
  Urls?: { ContentUrl?: OgdContentUrl | OgdContentUrl[] };
}

export interface OgdEntscheidungstext {
  Geschaeftszahl?: string;
  Entscheidungsdatum?: string;
  DokumentUrl?: string;
}

export interface OgdMetadaten {
  Technisch?: { ID?: string; Applikation?: string; Organ?: string };
  Allgemein?: { DokumentUrl?: string; Geaendert?: string; Veroeffentlicht?: string };
  Bundesrecht?: {
    Kurztitel?: string;
    Titel?: string;
    Eli?: string;
    BrKons?: {
      GesamteRechtsvorschriftUrl?: string;
      Inkrafttretensdatum?: string;
      Ausserkrafttretensdatum?: string;
    };
  };
  Landesrecht?: {
    Kurztitel?: string;
    Titel?: string;
    Eli?: string;
    Bundesland?: string;
    LrKons?: {
      GesamteRechtsvorschriftUrl?: string;
      Inkrafttretensdatum?: string;
      Ausserkrafttretensdatum?: string;
    };
  };
  Judikatur?: {
    Geschaeftszahl?: { item?: string | string[] };
    Entscheidungsdatum?: string;
    EuropeanCaseLawIdentifier?: string;
    /** Non-Justiz courts (VwGH, …) link their full decision via a single URL. */
    EntscheidungstextUrl?: string;
    Justiz?: {
      Rechtssatznummern?: { item?: string | string[] };
      Entscheidungstexte?: { item?: OgdEntscheidungstext | OgdEntscheidungstext[] };
    };
  };
}

export interface OgdReference {
  Data?: {
    Metadaten?: OgdMetadaten;
    Dokumentliste?: { ContentReference?: OgdContentReference | OgdContentReference[] };
  };
}

export interface OgdResponse {
  OgdSearchResult?: {
    /** Present instead of OgdDocumentResults when the API rejects the request. */
    Error?: { Applikation?: string; Message?: string };
    OgdDocumentResults?: {
      Hits?: { '#text'?: string; '@pageNumber'?: string; '@pageSize'?: string };
      OgdDocumentReference?: OgdReference | OgdReference[];
    };
  };
}
