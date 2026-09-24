import { accountSettingsParse } from '@happier-dev/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Credentials } from '@/persistence';
import type { AccountSettingsContext } from './bootstrapAccountSettingsContext';
import { refreshAccountSettingsForMinimumVersion } from './refreshAccountSettingsForMinimumVersion';

function createCredentialsStub(token = 'token'): Credentials {
  return {
    token,
    encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
  };
}

function createContext(settingsVersion: number): AccountSettingsContext {
  return {
    source: 'network',
    settings: accountSettingsParse({ schemaVersion: 6 }),
    settingsVersion,
    loadedAtMs: 1,
    settingsSecretsReadKeys: [],
    whenRefreshed: null,
  };
}

describe('refreshAccountSettingsForMinimumVersion', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns the active snapshot when it already satisfies the minimum version', async () => {
    const bootstrapAccountSettingsContext = vi.fn(async () => createContext(3));
    const result = await refreshAccountSettingsForMinimumVersion({
      credentials: createCredentialsStub(),
      minSettingsVersion: 2,
      deps: {
        getActiveSnapshot: () => ({ ...createContext(2), scopeKey: 'token-scope' }),
        bootstrapAccountSettingsContext,
        resolveScopeKey: () => 'token-scope',
      },
    });

    expect(result.settingsVersion).toBe(2);
    expect(bootstrapAccountSettingsContext).not.toHaveBeenCalled();
  });

  it('does not reuse an active snapshot from a different credentials scope', async () => {
    const bootstrapAccountSettingsContext = vi.fn(async () => createContext(6));
    const result = await refreshAccountSettingsForMinimumVersion({
      credentials: createCredentialsStub('token-b'),
      minSettingsVersion: 2,
      deps: {
        getActiveSnapshot: () => ({
          ...createContext(5),
          scopeKey: 'token-a-scope',
        }),
        bootstrapAccountSettingsContext,
        resolveScopeKey: () => 'token-b-scope',
      },
    });

    expect(result.settingsVersion).toBe(6);
    expect(bootstrapAccountSettingsContext).toHaveBeenCalledTimes(1);
  });

  it('forces a refresh when requested even if the active snapshot satisfies the minimum version', async () => {
    const bootstrapAccountSettingsContext = vi.fn(async () => createContext(4));
    const result = await refreshAccountSettingsForMinimumVersion({
      credentials: createCredentialsStub(),
      minSettingsVersion: 2,
      forceRefresh: true,
      deps: {
        getActiveSnapshot: () => ({ ...createContext(3), scopeKey: 'token-scope' }),
        bootstrapAccountSettingsContext,
        resolveScopeKey: () => 'token-scope',
      },
    });

    expect(result.settingsVersion).toBe(4);
    expect(bootstrapAccountSettingsContext).toHaveBeenCalledWith(expect.objectContaining({
      refresh: 'force',
      minSettingsVersion: 2,
    }));
  });

  it('dedupes concurrent refreshes for the same scope and minimum version', async () => {
    let resolveRefresh: (ctx: AccountSettingsContext) => void = () => {};
    const bootstrapAccountSettingsContext = vi.fn(() => new Promise<AccountSettingsContext>((resolve) => {
      resolveRefresh = resolve;
    }));

    const first = refreshAccountSettingsForMinimumVersion({
      credentials: createCredentialsStub(),
      minSettingsVersion: 5,
      deps: {
        getActiveSnapshot: () => null,
        bootstrapAccountSettingsContext,
      },
    });
    const second = refreshAccountSettingsForMinimumVersion({
      credentials: createCredentialsStub(),
      minSettingsVersion: 5,
      deps: {
        getActiveSnapshot: () => null,
        bootstrapAccountSettingsContext,
      },
    });

    resolveRefresh(createContext(5));

    await expect(Promise.all([first, second])).resolves.toEqual([createContext(5), createContext(5)]);
    expect(bootstrapAccountSettingsContext).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent refreshes for the same credentials scope across agents and backends', async () => {
    const resolveRefreshes: Array<(ctx: AccountSettingsContext) => void> = [];
    const bootstrapAccountSettingsContext = vi.fn(() => new Promise<AccountSettingsContext>((resolve) => {
      resolveRefreshes.push(resolve);
    }));

    const first = refreshAccountSettingsForMinimumVersion({
      credentials: createCredentialsStub(),
      minSettingsVersion: 5,
      agentId: 'claude',
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      deps: {
        getActiveSnapshot: () => null,
        bootstrapAccountSettingsContext,
        resolveScopeKey: () => 'token-scope',
      },
    });
    const second = refreshAccountSettingsForMinimumVersion({
      credentials: createCredentialsStub(),
      minSettingsVersion: 5,
      agentId: 'codex',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      deps: {
        getActiveSnapshot: () => null,
        bootstrapAccountSettingsContext,
        resolveScopeKey: () => 'token-scope',
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    for (const resolveRefresh of resolveRefreshes) {
      resolveRefresh(createContext(5));
    }

    await expect(Promise.all([first, second])).resolves.toEqual([createContext(5), createContext(5)]);
    expect(bootstrapAccountSettingsContext).toHaveBeenCalledTimes(1);
  });

  it('throws a stale account settings error when refresh returns below the required version', async () => {
    await expect(refreshAccountSettingsForMinimumVersion({
      credentials: createCredentialsStub(),
      minSettingsVersion: 5,
      deps: {
        getActiveSnapshot: () => null,
        bootstrapAccountSettingsContext: vi.fn(async () => createContext(4)),
      },
    })).rejects.toMatchObject({
      code: 'ACCOUNT_SETTINGS_STALE',
    });
  });
});
