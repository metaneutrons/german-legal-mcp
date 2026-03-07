export abstract class BaseError extends Error {
  abstract readonly code: string;
  abstract readonly userMessage: string;
  abstract readonly recoveryHint?: string;

  constructor(message: string, public readonly cause?: Error) {
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

  toString(): string {
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
  readonly code: string = 'RECOVERABLE_ERROR';
  readonly userMessage: string = 'A temporary error occurred. Please try again.';
  readonly recoveryHint?: string = 'Retry the operation after a short delay.';
}

export class PermanentError extends BaseError {
  readonly code: string = 'PERMANENT_ERROR';
  readonly userMessage: string = 'This operation cannot be completed.';
  readonly recoveryHint?: string = 'Check your input and try a different approach.';
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
  readonly code: string = 'NETWORK_ERROR';
  readonly userMessage: string = 'Network request failed.';
  readonly recoveryHint: string = 'Check your internet connection and retry.';
}

export class AuthenticationError extends PermanentError {
  readonly code: string = 'AUTHENTICATION_FAILED';
  readonly userMessage: string = 'Authentication failed. Check your credentials.';
  readonly recoveryHint: string = 'Verify credentials are correct.';
}

export class ValidationError extends PermanentError {
  readonly code: string = 'VALIDATION_ERROR';
  readonly userMessage: string = 'Invalid input provided.';
  declare readonly recoveryHint: string;
  
  constructor(message: string, public readonly field?: string, cause?: Error) {
    super(message, cause);
    this.recoveryHint = field ? `Check the '${field}' parameter.` : 'Check your input parameters.';
  }
}

export class CacheError extends RecoverableError {
  readonly code: string = 'CACHE_ERROR';
  readonly userMessage: string = 'Cache operation failed.';
  readonly recoveryHint: string = 'The operation will continue without cache.';
}

export class BrowserError extends RecoverableError {
  readonly code: string = 'BROWSER_ERROR';
  readonly userMessage: string = 'Browser operation failed.';
  readonly recoveryHint: string = 'Restart the MCP server to reinitialize the browser.';
}

export class WorkstationDeniedError extends PermanentError {
  readonly code: string = 'WORKSTATION_DENIED';
  readonly userMessage: string = 'Access denied from this workstation/IP address.';
  readonly recoveryHint: string = 'Your Beck Online subscription requires access from a specific IP range (e.g., campus network). Please connect to the correct network (VPN if needed) and try again.';
}
