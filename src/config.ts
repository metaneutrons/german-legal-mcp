/** Global log level configuration. */
export function getLogLevel(): string {
  return process.env.GLMCP_LOG_LEVEL || process.env.LOG_LEVEL || 'info';
}
