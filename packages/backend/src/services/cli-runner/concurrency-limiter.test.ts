import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter } from './concurrency-limiter.js';

describe('ConcurrencyLimiter', () => {
  it('allows up to maxGlobal concurrent acquisitions', async () => {
    const limiter = new ConcurrencyLimiter(2);
    await limiter.acquire('claude');
    await limiter.acquire('claude');
    const stats = limiter.getStats();
    expect(stats.running).toBe(2);
  });

  it('queues when global limit reached', async () => {
    const limiter = new ConcurrencyLimiter(1);
    await limiter.acquire('claude');

    let acquired = false;
    const waitPromise = limiter.acquire('claude').then(() => { acquired = true; });

    // Should still be queued
    expect(acquired).toBe(false);
    expect(limiter.getStats().queued).toBe(1);

    // Release to allow queued
    limiter.release('claude');
    await waitPromise;
    expect(acquired).toBe(true);
    expect(limiter.getStats().running).toBe(1);
  });

  it('enforces per-provider limits', async () => {
    const limiter = new ConcurrencyLimiter(3, new Map([['cursor', 1]]));
    await limiter.acquire('cursor');

    let cursorAcquired = false;
    const cursorWait = limiter.acquire('cursor').then(() => { cursorAcquired = true; });

    // Cursor should be queued even though global has room
    expect(cursorAcquired).toBe(false);

    // But claude should work fine
    await limiter.acquire('claude');
    expect(limiter.getStats().running).toBe(2);

    // Release cursor to unblock
    limiter.release('cursor');
    await cursorWait;
    expect(cursorAcquired).toBe(true);
  });

  it('release decrements correctly', () => {
    const limiter = new ConcurrencyLimiter(5);
    // Simulate acquire
    limiter.release('claude');
    const stats = limiter.getStats();
    // Running goes to -1 but perProvider floors at 0
    expect(stats.perProvider.claude).toBe(0);
  });

  it('getStats reflects state', async () => {
    const limiter = new ConcurrencyLimiter(2);
    await limiter.acquire('claude');
    await limiter.acquire('gemini');
    const stats = limiter.getStats();
    expect(stats.running).toBe(2);
    expect(stats.queued).toBe(0);
    expect(stats.perProvider.claude).toBe(1);
    expect(stats.perProvider.gemini).toBe(1);
  });
});
