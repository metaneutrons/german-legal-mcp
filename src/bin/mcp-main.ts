import type { ServerRuntime } from '../server.js';
import { createServerRuntime } from '../server.js';
import { rootLogger, sanitizeLogText } from '../shared/logger.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

export async function runMcpProcess(): Promise<void> {
  let runtime: ServerRuntime | undefined;
  let shuttingDown = false;

  const cleanup = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    rootLogger.info('Shutdown initiated', { signal });
    const timeout = new Promise<void>((resolve) => {
      globalThis.setTimeout(() => {
        rootLogger.warn('Shutdown timeout reached');
        resolve();
      }, SHUTDOWN_TIMEOUT_MS).unref();
    });
    await Promise.race([runtime?.shutdown() ?? Promise.resolve(), timeout]);
    rootLogger.info('Cleanup complete');
  };

  const fatal = (context: string, error: unknown): void => {
    const raw = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[german-legal-mcp] FATAL: ${context}\n${sanitizeLogText(raw)}\n`);
    rootLogger.error(`Fatal: ${context}`, error);
    void cleanup(context).finally(() => { process.exitCode = 1; });
  };

  process.once('uncaughtException', (error) => fatal('uncaught exception', error));
  process.once('unhandledRejection', (reason) => fatal('unhandled rejection', reason));
  process.once('SIGINT', () => { void cleanup('SIGINT').finally(() => { process.exitCode = 0; }); });
  process.once('SIGTERM', () => { void cleanup('SIGTERM').finally(() => { process.exitCode = 0; }); });
  process.stdin.once('close', () => { void cleanup('stdin close'); });

  runtime = await createServerRuntime();
  await runtime.connectStdio();
}
