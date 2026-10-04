import { describe, expect, it, vi } from 'vitest';

import { getOrLoadCatalogHookPromise } from './catalogHookPromiseCache';

describe('catalog hook promise cache', () => {
  it('starts the loader immediately and preserves the same promise including a null result', async () => {
    const cache = new Map<string, Promise<null>>();
    let complete!: (value: null) => void;
    const loading = new Promise<null>((resolve) => { complete = resolve; });
    const load = vi.fn(() => loading);

    const first = getOrLoadCatalogHookPromise(cache, 'provider', load);
    expect(load).toHaveBeenCalledOnce();
    expect(first).toBe(loading);
    expect(getOrLoadCatalogHookPromise(cache, 'provider', load)).toBe(loading);
    complete(null);
    await expect(first).resolves.toBeNull();
    expect(getOrLoadCatalogHookPromise(cache, 'provider', load)).toBe(loading);
    expect(load).toHaveBeenCalledOnce();
  });

  it('evicts a rejected load so the next call can recover', async () => {
    const cache = new Map<string, Promise<string>>();
    const failure = new Error('synthetic load rejection');
    const load = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('recovered');
    const first = getOrLoadCatalogHookPromise(cache, 'provider', load);
    expect(getOrLoadCatalogHookPromise(cache, 'provider', load)).toBe(first);
    await expect(first).rejects.toBe(failure);
    expect(cache.has('provider')).toBe(false);
    await expect(getOrLoadCatalogHookPromise(cache, 'provider', load)).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not remove a newer cache value when an earlier promise rejects', async () => {
    const cache = new Map<string, Promise<string>>();
    let rejectEarlier!: (error: Error) => void;
    const earlier = new Promise<string>((_, reject) => { rejectEarlier = reject; });
    getOrLoadCatalogHookPromise(cache, 'provider', () => earlier);
    const replacement = Promise.resolve('newer');
    cache.set('provider', replacement);
    const failure = new Error('stale rejection');
    rejectEarlier(failure);
    await expect(earlier).rejects.toBe(failure);
    const unusedLoader = vi.fn(async () => 'must not load');
    expect(getOrLoadCatalogHookPromise(cache, 'provider', unusedLoader)).toBe(replacement);
    expect(unusedLoader).not.toHaveBeenCalled();
  });

  it('does not cache or defer a synchronous loader exception', async () => {
    const cache = new Map<string, Promise<string>>();
    const failure = new Error('synthetic synchronous load failure');
    const load = vi.fn<() => Promise<string>>()
      .mockImplementationOnce(() => { throw failure; })
      .mockResolvedValueOnce('recovered');
    expect(() => getOrLoadCatalogHookPromise(cache, 'provider', load)).toThrow(failure);
    expect(cache.has('provider')).toBe(false);
    await expect(getOrLoadCatalogHookPromise(cache, 'provider', load)).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
