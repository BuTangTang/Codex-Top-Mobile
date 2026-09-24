import { describe, expect, it, vi } from 'vitest';

import { runMetadataOverridesWatcherLoop } from './metadataOverridesWatcher';

describe('runMetadataOverridesWatcherLoop', () => {
  it('backs off when waitForMetadataUpdate returns false for an aborted signal', async () => {
    vi.useFakeTimers();
    try {
      const abort = new AbortController();
      abort.abort();

      let exit = false;
      const waitForMetadataUpdate = vi.fn(async () => false);

      const loopPromise = runMetadataOverridesWatcherLoop({
        shouldExit: () => exit,
        getAbortSignal: () => abort.signal,
        waitForMetadataUpdate,
        onUpdate: () => {},
        abortedBackoffMs: 50,
      });

      // Allow the loop to run at least once.
      await Promise.resolve();
      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(1);

      // With a backoff, the loop should not call again until timers advance.
      await Promise.resolve();
      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(1);

      exit = true;
      await vi.advanceTimersByTimeAsync(50);
      await loopPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off when waitForMetadataUpdate returns false without an aborted signal', async () => {
    vi.useFakeTimers();
    try {
      let exit = false;
      let attempts = 0;
      const waitForMetadataUpdate = vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) return false;
        exit = true;
        return false;
      });

      const loopPromise = runMetadataOverridesWatcherLoop({
        shouldExit: () => exit,
        getAbortSignal: () => undefined,
        waitForMetadataUpdate,
        onUpdate: () => {},
        abortedBackoffMs: 50,
      });

      await Promise.resolve();
      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(1);

      await Promise.resolve();
      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(50);
      await loopPromise;

      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows transient waitForMetadataUpdate failures and retries after a backoff', async () => {
    vi.useFakeTimers();
    try {
      let exit = false;
      let attempts = 0;
      const waitForMetadataUpdate = vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('transient metadata wait failure');
        }
        exit = true;
        return false;
      });

      const loopPromise = runMetadataOverridesWatcherLoop({
        shouldExit: () => exit,
        getAbortSignal: () => undefined,
        waitForMetadataUpdate,
        onUpdate: () => {},
        abortedBackoffMs: 50,
      });

      await Promise.resolve();
      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(1);

      await Promise.resolve();
      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(50);
      await loopPromise;

      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows onUpdate failures so metadata watcher errors do not escape the background loop', async () => {
    vi.useFakeTimers();
    try {
      let exit = false;
      let attempts = 0;
      const waitForMetadataUpdate = vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          return true;
        }
        exit = true;
        return false;
      });
      const onUpdate = vi.fn(() => {
        throw new Error('metadata apply failed');
      });

      const loopPromise = runMetadataOverridesWatcherLoop({
        shouldExit: () => exit,
        getAbortSignal: () => undefined,
        waitForMetadataUpdate,
        onUpdate,
        abortedBackoffMs: 50,
      });

      await Promise.resolve();
      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      await Promise.resolve();
      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(50);
      await loopPromise;

      expect(waitForMetadataUpdate).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
