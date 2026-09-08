import axios from 'axios';
import { sanitizeLogText } from './logger.js';

export abstract class BaseError extends Error {
  abstract readonly code: string;
  abstract readonly userMessage: string;
  abstract readonly recoveryHint?: string;

  constructor(message: string, public override readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      recoveryHint: this.recoveryHint,
      cause: this.cause?.message,
    };
  }

  override toString(): string {
    let msg = `${this.userMessage}\n\nError Code: ${this.code}`;
    if (this.recoveryHint) {
      msg += `\n\nHow to fix: ${this.recoveryHint}`;
    }
    if (this.cause) {
      msg += `\n\nTechnical details: ${this.cause.message}`;
    }
    return msg;
  }
}

export class RecoverableError extends BaseError {
  override readonly code: string = 'RECOVERABLE_ERROR';
  override readonly userMessage: string = 'A temporary error occurred. Please try again.';
  override readonly recoveryHint?: string = 'Retry the operation after a short delay.';
}

export class PermanentError extends BaseError {
  override readonly code: string = 'PERMANENT_ERROR';
  override readonly userMessage: string = 'This operation cannot be completed.';
  override readonly recoveryHint?: string = 'Check your input and try a different approach.';
}

export class RateLimitError extends BaseError {
  readonly code: string = 'RATE_LIMIT_EXCEEDED';
  readonly userMessage: string = 'Rate limit exceeded. Please wait before retrying.';
  declare readonly recoveryHint: string;

  constructor(message: string, public readonly retryAfter: number, cause?: Error) {
    super(message, cause);
    this.recoveryHint = `Wait ${Math.ceil(retryAfter / 1000)}s before retrying. Restart the MCP server after waiting.`;
  }
}

export class NetworkError extends RecoverableError {
  override readonly code: string = 'NETWORK_ERROR';
  override readonly userMessage: string = 'Network request failed.';
  override readonly recoveryHint: string = 'Check your internet connection and retry.';
}

/**
 * Renders a thrown tool-call error the same way regardless of transport.
 *
 * The MCP stdio handler and the CLI dispatcher both call a `Provider`; a
 * network fault or a bug must not read differently depending on which one
 * happened to invoke it. Wraps an AxiosError as a BaseError first so both
 * transports get the structured `{code, userMessage, recoveryHint}` shape
 * instead of a bare Axios message.
 */
export function formatToolCallError(error: unknown): string {
  const wrapped = error instanceof BaseError ? error : wrapAxiosError(error);
  return wrapped
    ? JSON.stringify(wrapped.toJSON(), (_key, value) => (
      typeof value === 'string' ? sanitizeLogText(value) : value
    ), 2)
    : `Error: ${sanitizeLogText(error instanceof Error ? error.message : String(error))}`;
}

/** Convert AxiosError to a BaseError subclass */
export function wrapAxiosError(error: unknown): BaseError | null {
  if (!axios.isAxiosError(error)) return null;
  const axErr = error;
  const code = axErr.code ?? '';
  // Network-level failures (no response)
  if (!axErr.response) {
    if (code === 'ENOTFOUND') return new NetworkError(`DNS resolution failed: ${axErr.message}`, axErr);
    if (code === 'ECONNREFUSED') return new NetworkError(`Connection refused: ${axErr.message}`, axErr);
    if (code === 'ECONNRESET') return new NetworkError(`Connection reset: ${axErr.message}`, axErr);
    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') return new NetworkError(`Request timed out: ${axErr.message}`, axErr);
    return new NetworkError(axErr.message, axErr);
  }
  // HTTP-level failures
  const { status, statusText } = axErr.response;
  if (status === 404) return new PermanentError(`Not found (404): ${axErr.message}`);
  if (status === 403) return new PermanentError(`Forbidden (403): ${axErr.message}`);
  if (status === 401) return new AuthenticationError(`Unauthorized (401): ${axErr.message}`);
  if (status >= 500) return new NetworkError(`Server error (${status} ${statusText}): ${axErr.message}`, axErr);
  return new PermanentError(`HTTP ${status}: ${axErr.message}`);
}

export class AuthenticationError extends PermanentError {
  override readonly code: string = 'AUTHENTICATION_FAILED';
  override readonly userMessage: string = 'Authentication failed. Check your credentials.';
  override readonly recoveryHint: string = 'Verify credentials are correct.';
}

/**
 * The login flow did not complete in time — a navigation/OIDC step hung (a
 * headless-browser navigation timeout) or the network was unreachable. This is
 * a transient infrastructure condition, NOT a credential problem, so it must
 * not be reported as an AuthenticationError: the daemon relaunches the browser
 * and retries once, and a manual relogin (after checking network/VPN) or an MCP
 * restart recovers it.
 */
export class LoginTimeoutError extends RecoverableError {
  override readonly code: string = 'LOGIN_TIMEOUT';
  override readonly userMessage: string = 'Login timed out before a session was established.';
  override readonly recoveryHint: string =
    'This is a network/session issue, not wrong credentials. Check your internet/VPN connection, then retry authentication. If it persists, restart the MCP server to relaunch the login browser.';
}

export class ValidationError extends PermanentError {
  override readonly code: string = 'VALIDATION_ERROR';
  override readonly userMessage: string = 'Invalid input provided.';
  declare readonly recoveryHint: string;
  
  constructor(message: string, public readonly field?: string, cause?: Error) {
    super(message, cause);
    this.recoveryHint = field ? `Check the '${field}' parameter.` : 'Check your input parameters.';
  }
}

export class CacheError extends RecoverableError {
  override readonly code: string = 'CACHE_ERROR';
  override readonly userMessage: string = 'Cache operation failed.';
  override readonly recoveryHint: string = 'The operation will continue without cache.';
}

export class BrowserError extends RecoverableError {
  override readonly code: string = 'BROWSER_ERROR';
  override readonly userMessage: string = 'Browser operation failed.';
  override readonly recoveryHint: string = 'Restart the MCP server to reinitialize the browser.';
}

/**
 * A transient, mechanical browser fault — a detached frame, destroyed execution
 * context, or a closed target/session/protocol error. These are recovered
 * automatically inside the daemon (relaunch the browser and retry the
 * idempotent navigation); this class is only surfaced when that bounded retry is
 * exhausted, so the caller can simply retry rather than treat it as fatal.
 */
export class TransientBrowserError extends BrowserError {
  override readonly code: string = 'TRANSIENT_BROWSER_FAULT';
  override readonly userMessage: string = 'A transient browser fault occurred (the page was torn down mid-operation).';
  override readonly recoveryHint: string = 'This is retried automatically; if it persists, simply retry the request.';
}
