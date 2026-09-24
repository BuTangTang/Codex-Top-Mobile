import { describe, expect, it, vi } from 'vitest';

import { createConnectedServiceAccountModeCache } from './createConnectedServiceAccountModeCache';

describe('createConnectedServiceAccountModeCache', () => {
  it('invalidates a fresh cached account mode result', async () => {
    const cache = createConnectedServiceAccountModeCache({ successTtlMs: 60_000 });
    const api = {
      getAccountEncryptionMode: vi.fn()
        .mockResolvedValueOnce('plain')
        .mockResolvedValueOnce('e2ee'),
    };

    await expect(cache.resolve(api)).resolves.toBe('plain');
    cache.invalidate(api);
    await expect(cache.resolve(api)).resolves.toBe('e2ee');

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(2);
  });

  it('does not let an invalidated in-flight read repopulate a stale mode', async () => {
    const cache = createConnectedServiceAccountModeCache({ successTtlMs: 60_000 });
    let resolveFirst!: (value: 'plain') => void;
    let resolveSecond!: (value: 'e2ee') => void;
    const api = {
      getAccountEncryptionMode: vi.fn()
        .mockImplementationOnce(() => new Promise<'plain'>((resolve) => {
          resolveFirst = resolve;
        }))
        .mockImplementationOnce(() => new Promise<'e2ee'>((resolve) => {
          resolveSecond = resolve;
        })),
    };

    const first = cache.resolve(api);
    cache.invalidate(api);
    const second = cache.resolve(api);

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(2);

    resolveSecond('e2ee');
    await expect(second).resolves.toBe('e2ee');

    resolveFirst('plain');
    await expect(first).resolves.toBe('plain');
    await expect(cache.resolve(api)).resolves.toBe('e2ee');

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh read when refresh is called during an older in-flight read', async () => {
    const cache = createConnectedServiceAccountModeCache({ successTtlMs: 60_000 });
    let resolveFirst!: (value: 'plain') => void;
    let resolveSecond!: (value: 'e2ee') => void;
    const api = {
      getAccountEncryptionMode: vi.fn()
        .mockImplementationOnce(() => new Promise<'plain'>((resolve) => {
          resolveFirst = resolve;
        }))
        .mockImplementationOnce(() => new Promise<'e2ee'>((resolve) => {
          resolveSecond = resolve;
        })),
    };

    const first = cache.resolve(api);
    const refreshed = cache.refresh(api);

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(2);

    resolveSecond('e2ee');
    await expect(refreshed).resolves.toBe('e2ee');

    resolveFirst('plain');
    await expect(first).resolves.toBe('plain');
    await expect(cache.resolve(api)).resolves.toBe('e2ee');
  });

  it('backs off refresh reads while a recent account mode failure is fresh', async () => {
    let now = 0;
    const cache = createConnectedServiceAccountModeCache({
      successTtlMs: 60_000,
      errorTtlMs: 30_000,
      nowMs: () => now,
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => {
        throw new Error('server unavailable');
      }),
    };

    await expect(cache.refresh(api)).resolves.toBe('unknown');
    now = 5_000;
    await expect(cache.refresh(api)).resolves.toBe('unknown');

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(1);

    now = 30_001;
    await expect(cache.refresh(api)).resolves.toBe('unknown');
    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(2);
  });
});
