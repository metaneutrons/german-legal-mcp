import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Types of audit events that can be logged.
 */
export type AuditEventType = 
  | 'authentication_attempt'
  | 'authentication_success'
  | 'authentication_failure'
  | 'document_access'
  | 'search_query'
  | 'configuration_change'
  | 'error';

/**
 * Audit event structure.
 */
export interface AuditEvent {
  timestamp: string;
  type: AuditEventType;
  action: string;
  result: 'success' | 'failure';
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Audit logger for security and compliance tracking.
 * Logs to ~/.local/share/german-legal-mcp/audit.log
 * Disable with AUDIT_LOGGING=false
 */
class AuditLogger {
  private logPath: string;
  private enabled: boolean;

  constructor() {
    this.logPath = join(homedir(), '.local', 'share', 'german-legal-mcp', 'audit.log');
    this.enabled = process.env.AUDIT_LOGGING !== 'false';
  }

  /**
   * Log an audit event.
   * @example
   * await auditLogger.log({
   *   type: 'document_access',
   *   action: 'fetch',
   *   result: 'success',
   *   details: { vpath: 'bibdata/...' }
   * });
   */
  async log(event: Omit<AuditEvent, 'timestamp'>): Promise<void> {
    if (!this.enabled) return;

    const auditEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    try {
      await mkdir(join(this.logPath, '..'), { recursive: true });
      await appendFile(this.logPath, JSON.stringify(auditEvent) + '\n');
    } catch (error) {
      // Don't throw - audit logging should not break the application
      console.error('[Audit] Failed to write audit log:', error);
    }
  }

  async logAuth(action: string, result: 'success' | 'failure', details?: Record<string, unknown>): Promise<void> {
    await this.log({
      type: result === 'success' ? 'authentication_success' : 'authentication_failure',
      action,
      result,
      details,
    });
  }

  async logDocumentAccess(vpath: string, result: 'success' | 'failure'): Promise<void> {
    await this.log({
      type: 'document_access',
      action: 'fetch_document',
      result,
      details: { vpath },
    });
  }

  async logSearch(query: string, resultCount?: number): Promise<void> {
    await this.log({
      type: 'search_query',
      action: 'search',
      result: 'success',
      details: { query, resultCount },
    });
  }

  async logError(action: string, error: Error): Promise<void> {
    await this.log({
      type: 'error',
      action,
      result: 'failure',
      error: error.message,
      details: { stack: error.stack },
    });
  }
}

export const auditLogger = new AuditLogger();
