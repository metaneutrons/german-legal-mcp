import { BrowserError } from './errors.js';

/**
 * Error thrown when an operation exceeds its timeout.
 */
export class TimeoutError extends BrowserError {
  override readonly code = 'TIMEOUT_ERROR';
  declare readonly userMessage: string;
  declare readonly recoveryHint: string;

  constructor(operation: string, timeoutMs: number) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`);
    this.userMessage = `The operation took too long and was cancelled (timeout: ${timeoutMs / 1000}s).`;
    this.recoveryHint = 'Try again later. If the problem persists, the resource may be unavailable or the timeout may need to be increased.';
  }
}

/**
 * Race a promise against a timeout.
 * @throws {TimeoutError} If timeout is exceeded
 * @example
 * const result = await withTimeout(fetch('/api'), 5000, 'API fetch');
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    // eslint-disable-next-line no-undef
    timer = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      // eslint-disable-next-line no-undef
      clearTimeout(timer);
    }
  }
}
