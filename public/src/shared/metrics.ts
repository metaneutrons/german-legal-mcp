/**
 * Simple counter metric.
 */
export class Counter {
  private value = 0;

  /**
   * Increment counter by amount.
   */
  inc(amount = 1): void {
    this.value += amount;
  }

  /**
   * Get current counter value.
   */
  get(): number {
    return this.value;
  }

  /**
   * Reset counter to zero.
   */
  reset(): void {
    this.value = 0;
  }
}

/**
 * Histogram metric for tracking distributions.
 */
export class Histogram {
  private values: number[] = [];

  /**
   * Record a value.
   */
  observe(value: number): void {
    this.values.push(value);
  }

  /**
   * Get histogram statistics.
   */
  get(): { count: number; sum: number; avg: number; min: number; max: number } {
    if (this.values.length === 0) {
      return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
    }
    const sum = this.values.reduce((a, b) => a + b, 0);
    return {
      count: this.values.length,
      sum,
      avg: sum / this.values.length,
      min: Math.min(...this.values),
      max: Math.max(...this.values),
    };
  }

  reset(): void {
    this.values = [];
  }
}

export class Gauge {
  private value = 0;

  set(value: number): void {
    this.value = value;
  }

  inc(amount = 1): void {
    this.value += amount;
  }

  dec(amount = 1): void {
    this.value -= amount;
  }

  get(): number {
    return this.value;
  }
}

class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Histogram>();
  private gauges = new Map<string, Gauge>();

  counter(name: string): Counter {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Counter());
    }
    return this.counters.get(name)!;
  }

  histogram(name: string): Histogram {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Histogram());
    }
    return this.histograms.get(name)!;
  }

  gauge(name: string): Gauge {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Gauge());
    }
    return this.gauges.get(name)!;
  }

  getAll(): {
    counters: Record<string, number>;
    histograms: Record<string, ReturnType<Histogram['get']>>;
    gauges: Record<string, number>;
  } {
    const counters: Record<string, number> = {};
    const histograms: Record<string, ReturnType<Histogram['get']>> = {};
    const gauges: Record<string, number> = {};

    this.counters.forEach((counter, name) => {
      counters[name] = counter.get();
    });

    this.histograms.forEach((histogram, name) => {
      histograms[name] = histogram.get();
    });

    this.gauges.forEach((gauge, name) => {
      gauges[name] = gauge.get();
    });

    return { counters, histograms, gauges };
  }

  reset(): void {
    this.counters.forEach(c => c.reset());
    this.histograms.forEach(h => h.reset());
  }
}

export const metrics = new MetricsRegistry();

// Pre-defined metrics
export const requestCount = metrics.counter('request_count');
export const requestDuration = metrics.histogram('request_duration_ms');
export const cacheHits = metrics.counter('cache_hits');
export const cacheMisses = metrics.counter('cache_misses');
export const rateLimitHits = metrics.counter('rate_limit_hits');
export const errorCount = metrics.counter('error_count');
export const activeRequests = metrics.gauge('active_requests');
