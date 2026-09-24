import { describe, expect, it } from 'vitest';

import { createKeyedBackoffTracker } from './createKeyedBackoffTracker';

describe('createKeyedBackoffTracker', () => {
  it('increases exponential backoff delays up to the configured cap', () => {
    let nowMs = 0;
    const tracker = createKeyedBackoffTracker({
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      now: () => nowMs,
    });

    expect(tracker.recordFailure('profile').delayMs).toBe(1000);

    nowMs = 1000;
    expect(tracker.recordFailure('profile').delayMs).toBe(2000);

    nowMs = 3000;
    expect(tracker.recordFailure('profile').delayMs).toBe(4000);

    nowMs = 7000;
    expect(tracker.recordFailure('profile').delayMs).toBe(5000);
  });

  it('uses retry-after as a floor for the next eligible time', () => {
    const tracker = createKeyedBackoffTracker({
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      now: () => 2000,
    });

    const state = tracker.recordFailure('profile', { retryAfterMs: 12000 });

    expect(state.delayMs).toBe(12000);
    expect(state.retryAtMs).toBe(14000);
  });

  it('resets a key after success', () => {
    let nowMs = 0;
    const tracker = createKeyedBackoffTracker({
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      now: () => nowMs,
    });

    tracker.recordFailure('profile');
    nowMs = 1000;
    tracker.recordFailure('profile');

    tracker.recordSuccess('profile');

    expect(tracker.getState('profile')).toBeNull();
    expect(tracker.getDelayMs('profile')).toBe(0);
    expect(tracker.recordFailure('profile').delayMs).toBe(1000);
  });

  it('applies deterministic jitter from the injected random source', () => {
    const tracker = createKeyedBackoffTracker({
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      jitterRatio: 0.5,
      now: () => 0,
      random: () => 1,
    });

    const state = tracker.recordFailure('profile');

    expect(state.delayMs).toBe(1500);
    expect(state.retryAtMs).toBe(1500);
  });
});
