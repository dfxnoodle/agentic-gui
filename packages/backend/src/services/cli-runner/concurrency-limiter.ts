/**
 * Simple counting semaphore for limiting concurrent CLI jobs.
 */
export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];
  private perProviderRunning = new Map<string, number>();

  constructor(
    private maxGlobal: number,
    private perProviderMax: Map<string, number> = new Map(),
  ) {}

  async acquire(provider: string): Promise<void> {
    const providerMax = this.perProviderMax.get(provider) ?? this.maxGlobal;
    const providerRunning = this.perProviderRunning.get(provider) ?? 0;

    if (this.running < this.maxGlobal && providerRunning < providerMax) {
      this.running++;
      this.perProviderRunning.set(provider, providerRunning + 1);
      return;
    }

    // Queue and wait
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        const current = this.perProviderRunning.get(provider) ?? 0;
        this.perProviderRunning.set(provider, current + 1);
        resolve();
      });
    });
  }

  release(provider: string): void {
    this.running--;
    const current = this.perProviderRunning.get(provider) ?? 1;
    this.perProviderRunning.set(provider, Math.max(0, current - 1));

    // Try to dequeue
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }

  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      perProvider: Object.fromEntries(this.perProviderRunning),
    };
  }
}
