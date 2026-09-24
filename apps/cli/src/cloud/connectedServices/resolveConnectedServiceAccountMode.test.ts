import { describe, expect, it, vi } from 'vitest';

import { resolveConnectedServiceAccountMode } from './resolveConnectedServiceAccountMode';

describe('resolveConnectedServiceAccountMode', () => {
  it('dedupes concurrent account mode reads for the same API client', async () => {
    let resolveMode!: (mode: 'plain') => void;
    const api = {
      getAccountEncryptionMode: vi.fn(() => new Promise<'plain'>((resolve) => {
        resolveMode = resolve;
      })),
    };

    const first = resolveConnectedServiceAccountMode(api);
    const second = resolveConnectedServiceAccountMode(api);

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(1);
    resolveMode('plain');
    await expect(Promise.all([first, second])).resolves.toEqual(['plain', 'plain']);
  });

  it('reuses a fresh successful account mode result', async () => {
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
    };

    await expect(resolveConnectedServiceAccountMode(api)).resolves.toBe('plain');
    await expect(resolveConnectedServiceAccountMode(api)).resolves.toBe('plain');

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(1);
  });

  it('can refresh a fresh cached account mode result for flush-time resolution', async () => {
    let mode: 'plain' | 'e2ee' = 'plain';
    const api = {
      getAccountEncryptionMode: vi.fn(async () => mode),
    };

    await expect(resolveConnectedServiceAccountMode(api)).resolves.toBe('plain');
    mode = 'e2ee';
    await expect(resolveConnectedServiceAccountMode(api, { refresh: true })).resolves.toBe('e2ee');

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent refreshes for the same API client', async () => {
    let resolveMode!: (mode: 'e2ee') => void;
    const api = {
      getAccountEncryptionMode: vi.fn(() => new Promise<'e2ee'>((resolve) => {
        resolveMode = resolve;
      })),
    };

    const first = resolveConnectedServiceAccountMode(api, { refresh: true });
    const second = resolveConnectedServiceAccountMode(api, { refresh: true });

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(1);
    resolveMode('e2ee');
    await expect(Promise.all([first, second])).resolves.toEqual(['e2ee', 'e2ee']);
  });

  it('backs off after failures while returning unknown', async () => {
    const api = {
      getAccountEncryptionMode: vi.fn(async () => {
        throw new Error('server unavailable');
      }),
    };

    await expect(resolveConnectedServiceAccountMode(api)).resolves.toBe('unknown');
    await expect(resolveConnectedServiceAccountMode(api)).resolves.toBe('unknown');

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(1);
  });

  it('does not force-refresh account mode immediately after a recent failure', async () => {
    const api = {
      getAccountEncryptionMode: vi.fn(async () => {
        throw new Error('server unavailable');
      }),
    };

    await expect(resolveConnectedServiceAccountMode(api, { refresh: true })).resolves.toBe('unknown');
    await expect(resolveConnectedServiceAccountMode(api, { refresh: true })).resolves.toBe('unknown');

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(1);
  });

  it('refreshes cached account mode when requested for mode-sensitive writes', async () => {
    const api = {
      getAccountEncryptionMode: vi.fn()
        .mockResolvedValueOnce('plain')
        .mockResolvedValueOnce('e2ee'),
    };

    await expect(resolveConnectedServiceAccountMode(api)).resolves.toBe('plain');
    await expect(resolveConnectedServiceAccountMode(api, { refresh: true })).resolves.toBe('e2ee');

    expect(api.getAccountEncryptionMode).toHaveBeenCalledTimes(2);
  });
});
