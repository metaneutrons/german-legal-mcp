import { Logger } from './logger.js';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterMs: 500,
};

export class RetryStrategy {
  private logger: Logger;

  constructor(private options: RetryOptions = DEFAULT_RETRY_OPTIONS, logger?: Logger) {
    this.logger = logger || new Logger();
  }

  async execute<T>(
    fn: () => Promise<T>,
    shouldRetry: (error: unknown) => boolean = this.isTransientError
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === this.options.maxAttempts || !shouldRetry(error)) {
          throw error;
        }

        const delay = this.calculateDelay(attempt);
        this.logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, {
          attempt,
          maxAttempts: this.options.maxAttempts,
          error: error instanceof Error ? error.message : String(error),
        });

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay = this.options.baseDelayMs * Math.pow(this.options.backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, this.options.maxDelayMs);
    const jitter = Math.random() * this.options.jitterMs;
    return Math.floor(cappedDelay + jitter);
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('enotfound') ||
        message.includes('503') ||
        message.includes('502') ||
        message.includes('504')
      );
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      // eslint-disable-next-line no-undef
      setTimeout(resolve, ms);
    });
  }
}
