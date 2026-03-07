import { rootLogger } from './logger.js';

const logger = rootLogger.child({ module: 'resource-monitor' });

/**
 * Resource limit configuration.
 */
export interface ResourceLimits {
  maxMemoryMB: number;
  maxCpuPercent: number;
}

/**
 * Monitor resource usage and log warnings when limits are exceeded.
 * Configure with MAX_MEMORY_MB env var.
 */
export class ResourceMonitor {
  private limits: ResourceLimits;
  // eslint-disable-next-line no-undef
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(limits?: Partial<ResourceLimits>) {
    this.limits = {
      maxMemoryMB: limits?.maxMemoryMB || 512,
      maxCpuPercent: limits?.maxCpuPercent || 100,
    };
  }

  /**
   * Start periodic resource checks.
   * @param intervalMs - Check interval in milliseconds (default: 60000)
   */
  start(intervalMs = 60000): void {
    if (this.checkInterval) return;

    // eslint-disable-next-line no-undef
    this.checkInterval = setInterval(() => {
      this.check();
    }, intervalMs);
  }

  /**
   * Stop resource monitoring.
   */
  stop(): void {
    if (this.checkInterval) {
      // eslint-disable-next-line no-undef
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check current resource usage and log warnings if limits exceeded.
   */
  check(): void {
    const memUsage = process.memoryUsage();
    const memUsedMB = memUsage.heapUsed / 1024 / 1024;
    const memTotalMB = memUsage.heapTotal / 1024 / 1024;

    if (memUsedMB > this.limits.maxMemoryMB) {
      logger.warn('Memory limit exceeded', {
        used: Math.round(memUsedMB),
        limit: this.limits.maxMemoryMB,
        total: Math.round(memTotalMB),
      });
    }

    // Log current usage for monitoring
    logger.debug('Resource usage', {
      memoryMB: Math.round(memUsedMB),
      memoryTotalMB: Math.round(memTotalMB),
    });
  }

  /**
   * Get current resource usage snapshot.
   * @returns Memory usage in MB
   */
  getUsage() {
    const memUsage = process.memoryUsage();
    return {
      memoryMB: memUsage.heapUsed / 1024 / 1024,
      memoryTotalMB: memUsage.heapTotal / 1024 / 1024,
      rss: memUsage.rss / 1024 / 1024,
    };
  }
}

/**
 * Global resource monitor instance.
 */
export const resourceMonitor = new ResourceMonitor({
  maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB || '512', 10),
});
