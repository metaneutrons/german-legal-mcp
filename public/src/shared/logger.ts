import pino from 'pino';
import { getLogLevel } from '../config.js';

const logger = pino({
  level: getLogLevel(),
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      destination: 2, // Write to stderr (fd 2) for MCP compatibility
    },
  } : undefined,
}, pino.destination({ dest: 2, sync: false })); // Default to stderr

export type LogContext = {
  requestId?: string;
  operation?: string;
  vpath?: string;
  url?: string;
  duration?: number;
  [key: string]: unknown;
};

export class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  debug(msg: string, context?: LogContext): void {
    logger.debug({ ...this.context, ...context }, msg);
  }

  info(msg: string, context?: LogContext): void {
    logger.info({ ...this.context, ...context }, msg);
  }

  warn(msg: string, context?: LogContext): void {
    logger.warn({ ...this.context, ...context }, msg);
  }

  error(msg: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext = error instanceof Error ? {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    } : { error };
    logger.error({ ...this.context, ...context, ...errorContext }, msg);
  }
}

export const rootLogger = new Logger();
