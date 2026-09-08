import { RecoverableError } from '../../shared/errors.js';

/**
 * InfoCuria's gateway returns its branded maintenance page with HTTP 403.
 * That response is not an authentication decision: the same page is returned
 * by the public web UI and the public search API, including without cookies.
 */
export class IcuUnavailableError extends RecoverableError {
  override readonly code = 'ICU_UNAVAILABLE';
  override readonly userMessage = 'InfoCuria is temporarily unavailable.';
  override readonly recoveryHint = 'Retry the InfoCuria request after a short delay.';
}

interface AxiosLikeError {
  isAxiosError?: boolean;
  response?: { status?: number; data?: unknown };
}

function asAxiosError(error: unknown): AxiosLikeError | null {
  if (!error || typeof error !== 'object' || (error as AxiosLikeError).isAxiosError !== true) return null;
  return error as AxiosLikeError;
}

function responseBody(error: unknown): string {
  const axErr = asAxiosError(error);
  if (!axErr) return '';
  const data = axErr.response?.data;
  return typeof data === 'string' ? data.toLowerCase() : '';
}

/** Match only Curia's branded maintenance HTML, not arbitrary 403 responses. */
export function isIcuUnavailableResponse(error: unknown): boolean {
  const axErr = asAxiosError(error);
  if (axErr?.response?.status !== 403) return false;
  const body = responseBody(error);
  return body.includes('curia.europa.eu')
    && (
      body.includes('temporarily unavailable')
      || body.includes('momentanément indisponible')
      || body.includes('momentan nicht verfügbar')
      || body.includes('momentaneamente indisponibile')
    );
}

export function classifyIcuError(error: unknown): unknown {
  if (!isIcuUnavailableResponse(error)) return error;
  return new IcuUnavailableError('InfoCuria returned its temporary-unavailability page.', error instanceof Error ? error : undefined);
}
