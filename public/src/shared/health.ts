import { rootLogger } from './logger.js';

const logger = rootLogger.child({ module: 'health' });

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy';
  message?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheck[];
  timestamp: string;
}

export class HealthChecker {
  private checks: Array<() => Promise<HealthCheck>> = [];

  register(check: () => Promise<HealthCheck>): void {
    this.checks.push(check);
  }

  async check(): Promise<HealthStatus> {
    const results = await Promise.all(
      this.checks.map(async check => {
        try {
          return await check();
        } catch (error) {
          logger.error('Health check failed', error as Error);
          return {
            name: 'unknown',
            status: 'unhealthy' as const,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );

    const unhealthy = results.filter(r => r.status === 'unhealthy');
    const status = unhealthy.length === 0 ? 'healthy' : 
                   unhealthy.length === results.length ? 'unhealthy' : 'degraded';

    return {
      status,
      checks: results,
      timestamp: new Date().toISOString(),
    };
  }
}

export const healthChecker = new HealthChecker();
