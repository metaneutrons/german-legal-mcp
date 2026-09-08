import { RecoverableError } from '../../shared/errors.js';

/**
 * Raised when the RIS OGD API returns an `OgdSearchResult.Error` envelope
 * (e.g. a schema-validation rejection of a query parameter) instead of results.
 * Without this the error was silently swallowed into an empty result set.
 */
export class RisApiError extends RecoverableError {
  override readonly code: string = 'RIS_API_ERROR';
  override readonly userMessage: string = 'The Austrian RIS API rejected the request.';
  override readonly recoveryHint: string =
    'Adjust the query and retry; if it persists, RIS may be temporarily unavailable.';
}
