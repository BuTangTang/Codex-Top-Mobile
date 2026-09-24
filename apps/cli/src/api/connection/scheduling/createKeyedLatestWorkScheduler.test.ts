import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKeyedBackoffTracker } from './createKeyedBackoffTracker';
import { createKeyedLatestWorkScheduler } from './createKeyedLatestWorkScheduler';

describe('createKeyedLatestWorkScheduler', () => {
  function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs only the latest pending payload for a key', async () => {
    vi.useFakeTimers();
    let connected = false;
    const seen: string[] = [];
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (_key, payload) => {
        seen.push(payload);
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
      isConnected: () => connected,
    });

    expect(scheduler.enqueue('profile', 'old').type).toBe('accepted');
    expect(scheduler.enqueue('profile', 'new').type).toBe('coalesced');

    connected = true;
    scheduler.notifyConnectivityChanged();
    await vi.runAllTimersAsync();

    expect(seen).toEqual(['new']);
    expect(scheduler.getCounters()).toMatchObject({ accepted: 1, coalesced: 1, started: 1, succeeded: 1 });
  });

  it('queues one latest payload while a key is in flight', async () => {
    vi.useFakeTimers();
    const first = createDeferred();
    const seen: string[] = [];
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (_key, payload) => {
        seen.push(payload);
        if (payload === 'first') await first.promise;
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
    });

    scheduler.enqueue('profile', 'first');
    await vi.runAllTimersAsync();
    scheduler.enqueue('profile', 'second');
    scheduler.enqueue('profile', 'third');

    expect(seen).toEqual(['first']);

    first.resolve(undefined);
    await vi.runAllTimersAsync();

    expect(seen).toEqual(['first', 'third']);
  });

  it('respects the global concurrency cap across keys', async () => {
    vi.useFakeTimers();
    const first = createDeferred();
    const seen: string[] = [];
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (key) => {
        seen.push(key);
        if (key === 'a') await first.promise;
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
    });

    scheduler.enqueue('a', 'one');
    scheduler.enqueue('b', 'two');
    await vi.runAllTimersAsync();

    expect(seen).toEqual(['a']);

    first.resolve(undefined);
    await vi.runAllTimersAsync();

    expect(seen).toEqual(['a', 'b']);
  });

  it('coalesces the first payload on the trailing edge of the per-key interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const seen: string[] = [];
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (_key, payload) => {
        seen.push(payload);
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 5_000,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
      now: () => Date.now(),
    });

    expect(scheduler.enqueue('profile', 'first').type).toBe('accepted');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(seen).toEqual([]);

    expect(scheduler.enqueue('profile', 'latest').type).toBe('coalesced');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(seen).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual(['latest']);
  });

  it('suppresses non-material repeats inside the per-key interval', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (_key, payload) => {
        seen.push(payload);
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 1000,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
    });

    scheduler.enqueue('profile', 'first');
    await vi.runAllTimersAsync();
    expect(scheduler.enqueue('profile', 'repeat', { material: false }).type).toBe('suppressed');
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen).toEqual(['first']);
    expect(scheduler.getCounters().suppressed).toBe(1);
  });

  it('defers retryable failures through the keyed backoff tracker', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    let attempts = 0;
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (_key, payload) => {
        attempts += 1;
        if (payload === 'retry' && attempts === 1) {
          throw new Error('retryable');
        }
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
      now: () => nowMs,
      backoff: createKeyedBackoffTracker({
        baseDelayMs: 1000,
        maxDelayMs: 1000,
        now: () => nowMs,
      }),
    });

    scheduler.enqueue('profile', 'retry');
    await vi.advanceTimersByTimeAsync(0);

    expect(attempts).toBe(1);
    expect(scheduler.getCounters()).toMatchObject({ failed: 1, retried: 1, deferred: 1 });

    await vi.advanceTimersByTimeAsync(999);
    nowMs = 999;
    expect(attempts).toBe(1);

    nowMs = 1000;
    await vi.advanceTimersByTimeAsync(1);

    expect(attempts).toBe(2);
  });

  it('honors retryAfterMs from retryable errors before retrying', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    let attempts = 0;
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('retry later') as Error & { retryAfterMs: number };
          error.retryAfterMs = 5_000;
          throw error;
        }
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
      now: () => nowMs,
      backoff: createKeyedBackoffTracker({
        baseDelayMs: 100,
        maxDelayMs: 100,
        now: () => nowMs,
      }),
    });

    scheduler.enqueue('profile', 'payload');
    await vi.advanceTimersByTimeAsync(0);

    expect(attempts).toBe(1);

    nowMs = 4_999;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(attempts).toBe(1);

    nowMs = 5_000;
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(2);
  });

  it('defers while offline and resumes when connectivity is restored', async () => {
    vi.useFakeTimers();
    let connected = false;
    const seen: string[] = [];
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (_key, payload) => {
        seen.push(payload);
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
      isConnected: () => connected,
    });

    scheduler.enqueue('profile', 'payload');
    await vi.runAllTimersAsync();
    expect(seen).toEqual([]);

    connected = true;
    scheduler.notifyConnectivityChanged();
    await vi.runAllTimersAsync();

    expect(seen).toEqual(['payload']);
  });

  it('bounds retained keys by evicting oldest idle or pending keys', () => {
    vi.useFakeTimers();
    let connected = false;
    const scheduler = createKeyedLatestWorkScheduler<string, number>({
      run: async () => {},
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 3,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
      isConnected: () => connected,
    });

    for (let index = 0; index < 10_000; index += 1) {
      scheduler.enqueue(`profile-${index}`, index);
    }

    expect(scheduler.getStats().retainedKeyCount).toBeLessThanOrEqual(3);
    expect(scheduler.getCounters().suppressed).toBeGreaterThan(0);

    connected = true;
    scheduler.notifyConnectivityChanged();
  });

  it('suppresses a new key instead of silently dropping it when all retained keys are in flight', async () => {
    vi.useFakeTimers();
    const first = createDeferred();
    const seen: string[] = [];
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (key) => {
        seen.push(key);
        if (key === 'active') await first.promise;
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 1,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
    });

    expect(scheduler.enqueue('active', 'payload').type).toBe('accepted');
    await vi.runAllTimersAsync();

    expect(seen).toEqual(['active']);
    expect(scheduler.enqueue('overflow', 'payload')).toEqual({ type: 'suppressed', reason: 'max_keys' });
    expect(scheduler.getStats().retainedKeyCount).toBe(1);
    expect(scheduler.getCounters().suppressed).toBe(1);

    first.resolve(undefined);
    await vi.runAllTimersAsync();
    expect(seen).toEqual(['active']);
  });

  it('evicts idle keys after the configured key age', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async () => {},
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 1000,
      maxPendingPayloadAgeMs: 60_000,
      now: () => nowMs,
    });

    scheduler.enqueue('old', 'payload');
    await vi.runAllTimersAsync();

    nowMs = 1001;
    scheduler.enqueue('new', 'payload');

    expect(scheduler.getStats().retainedKeyCount).toBe(1);
  });

  it('drops stale pending payloads before they run', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    let connected = false;
    const seen: string[] = [];
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (_key, payload) => {
        seen.push(payload);
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 1000,
      now: () => nowMs,
      isConnected: () => connected,
    });

    scheduler.enqueue('profile', 'stale');
    nowMs = 1001;
    connected = true;
    scheduler.notifyConnectivityChanged();
    await vi.runAllTimersAsync();

    expect(seen).toEqual([]);
    expect(scheduler.getCounters().suppressed).toBe(1);
  });

  it('flushAll resolves within the supplied timeout', async () => {
    vi.useFakeTimers();
    const never = createDeferred();
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async () => {
        await never.promise;
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
    });

    scheduler.enqueue('profile', 'payload');
    const flushed = scheduler.flushAll(50);
    await vi.advanceTimersByTimeAsync(50);

    await expect(flushed).resolves.toBeUndefined();
  });

  it('flushAll times out without zero-delay polling when pending work is deferred by backoff', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async () => {
        attempts += 1;
        throw new Error('retryable');
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
      backoff: createKeyedBackoffTracker({
        baseDelayMs: 1_000,
        maxDelayMs: 1_000,
      }),
    });

    scheduler.enqueue('profile', 'payload');
    await vi.advanceTimersByTimeAsync(0);

    const flushed = scheduler.flushAll(50);
    await vi.advanceTimersByTimeAsync(49);
    await expect(Promise.race([flushed.then(() => 'flushed' as const), Promise.resolve('pending' as const)])).resolves.toBe('pending');
    await vi.advanceTimersByTimeAsync(1);

    await expect(flushed).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it('cancel and dispose clear pending timers and retained entries', async () => {
    vi.useFakeTimers();
    let connected = false;
    const seen: string[] = [];
    const scheduler = createKeyedLatestWorkScheduler<string, string>({
      run: async (_key, payload) => {
        seen.push(payload);
      },
      maxConcurrent: 1,
      minKeyIntervalMs: 0,
      maxKeys: 10,
      maxKeyAgeMs: 60_000,
      maxPendingPayloadAgeMs: 60_000,
      isConnected: () => connected,
    });

    scheduler.enqueue('cancelled', 'payload');
    scheduler.cancelKey('cancelled');
    expect(scheduler.getStats().retainedKeyCount).toBe(0);

    scheduler.enqueue('disposed', 'payload');
    scheduler.dispose();
    connected = true;
    scheduler.notifyConnectivityChanged();
    await vi.runAllTimersAsync();

    expect(seen).toEqual([]);
    expect(scheduler.getStats().retainedKeyCount).toBe(0);
  });
});
