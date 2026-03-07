/**
 * Request batcher for reducing navigation overhead.
 * Batches multiple requests within a time window.
 */

interface BatchRequest<T> {
  key: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class RequestBatcher<T> {
  private queue: BatchRequest<T>[] = [];
  // eslint-disable-next-line no-undef
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;
  private readonly executor: (keys: string[]) => Promise<Map<string, T>>;

  constructor(executor: (keys: string[]) => Promise<Map<string, T>>, windowMs = 100) {
    this.executor = executor;
    this.windowMs = windowMs;
  }

  async add(key: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ key, resolve, reject });

      if (!this.timer) {
        // eslint-disable-next-line no-undef
        this.timer = setTimeout(() => this.flush(), this.windowMs);
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    this.timer = null;

    try {
      const keys = batch.map(r => r.key);
      const results = await this.executor(keys);

      for (const req of batch) {
        const result = results.get(req.key);
        if (result) {
          req.resolve(result);
        } else {
          req.reject(new Error(`No result for key: ${req.key}`));
        }
      }
    } catch (error) {
      for (const req of batch) {
        req.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
