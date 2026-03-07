import { Logger } from './logger.js';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenAttempts: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private openedAt?: number;
  private logger: Logger;

  constructor(
    private name: string,
    private options: CircuitBreakerOptions,
    logger?: Logger
  ) {
    this.logger = logger?.child({ circuit: name }) || new Logger({ circuit: name });
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - (this.openedAt || 0) >= this.options.cooldownMs) {
        this.logger.info('Circuit transitioning to HALF_OPEN');
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        const waitMs = this.options.cooldownMs - (Date.now() - (this.openedAt || 0));
        throw new Error(`Circuit breaker is OPEN. Retry after ${Math.ceil(waitMs / 1000)}s`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.halfOpenAttempts) {
        this.logger.info('Circuit recovered, transitioning to CLOSED');
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.logger.warn('Circuit failed in HALF_OPEN, reopening');
      this.open();
    } else if (this.failureCount >= this.options.failureThreshold) {
      this.logger.error('Failure threshold reached, opening circuit', undefined, {
        failureCount: this.failureCount,
        threshold: this.options.failureThreshold,
      });
      this.open();
    }
  }

  private open(): void {
    this.state = CircuitState.OPEN;
    this.openedAt = Date.now();
    this.failureCount = 0;
  }

  getState(): CircuitState {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = undefined;
    this.logger.info('Circuit manually reset');
  }
}
