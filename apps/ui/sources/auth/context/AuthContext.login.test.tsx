import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen } from '@/dev/testkit';

(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;

const writeControl = vi.hoisted(() => ({ afterWrite: null as null | ((key: string) => Promise<void>) }));
const secureStore = vi.hoisted(() => new Map<string, string>());
const asyncStorage = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-secure-store', () => ({
    getItemAsync: async (key: string) => secureStore.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
        secureStore.set(key, value);
        await writeControl.afterWrite?.(key);
    },
    deleteItemAsync: async (key: string) => {
        secureStore.delete(key);
    },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => asyncStorage.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            asyncStorage.set(key, value);
        },
        removeItem: async (key: string) => {
            asyncStorage.delete(key);
        },
    },
}));

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/voice/context/voiceHooks', () => ({
    voiceHooks: {
        onSessionFocus: vi.fn(),
        onSessionOffline: vi.fn(),
        onSessionOnline: vi.fn(),
        onMessages: vi.fn(),
        reportContextualUpdate: vi.fn(),
    },
}));

vi.mock('@/track', () => ({
    trackLogout: vi.fn(),
    initializeTracking: vi.fn(),
    tracking: null,
}));

function buildTokenWithSub(sub: string): string {
    const payload = Buffer.from(JSON.stringify({ sub })).toString('base64');
    return `hdr.${payload}.sig`;
}

describe('AuthContext.login', () => {
    let restoreLocalStorage: (() => void) | undefined;
    beforeEach(() => {
        vi.useFakeTimers();
        restoreLocalStorage = installLocalStorageMock().restore;
        secureStore.clear();
        writeControl.afterWrite = null;
        asyncStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
        restoreLocalStorage?.();
        vi.unstubAllGlobals();
    });

    it('rejects a stale password-login server before saving or activating credentials', async () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
        const { upsertAndActivateServer, getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'https://password-a.test', scope: 'device' });
        const expectedActiveServerSnapshot = getActiveServerSnapshot();
        upsertAndActivateServer({ serverUrl: 'https://password-b.test', scope: 'device' });
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(<AuthProvider initialCredentials={null}><React.Fragment /></AuthProvider>);
        try {
            await expect(getCurrentAuth()!.loginWithCredentials({ token: buildTokenWithSub('synthetic'), secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, { expectedActiveServerSnapshot })).rejects.toThrow('Authentication cancelled');
            expect(getCurrentAuth()!.isAuthenticated).toBe(false);
            expect([...secureStore.values()].some((value) => value.includes('synthetic'))).toBe(false);
        } finally { await screen.unmount(); }
    });

    it.each(['auth_credentials', 'auth_auto_redirect_suppressed_until'])('does not retain a cancelled login after %s finishes across a switch', async (writePrefix) => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
        const { upsertAndActivateServer, getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'https://password-a.test', scope: 'device' });
        const expectedActiveServerSnapshot = getActiveServerSnapshot();
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(<AuthProvider initialCredentials={null}><React.Fragment /></AuthProvider>);
        writeControl.afterWrite = async (key) => {
            if (!key.startsWith(writePrefix)) return;
            writeControl.afterWrite = null;
            upsertAndActivateServer({ serverUrl: 'https://password-b.test', scope: 'device' });
        };
        try {
            await act(async () => {
                await expect(getCurrentAuth()!.loginWithCredentials({ token: buildTokenWithSub('synthetic'), secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, { expectedActiveServerSnapshot })).rejects.toThrow('Authentication cancelled');
            });
            expect(getCurrentAuth()!.isAuthenticated).toBe(false);
            const { TokenStorage } = await import('@/auth/storage/tokenStorage');
            expect(await TokenStorage.getCredentials()).toBeNull();
            expect(await TokenStorage.getCredentialsForServerUrl(expectedActiveServerSnapshot.serverUrl, { serverId: expectedActiveServerSnapshot.serverId })).toBeNull();
        } finally { writeControl.afterWrite = null; await screen.unmount(); }
    });

    it('does not reactivate a login whose secure storage finishes after logout', async () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'https://cancel-login.test', scope: 'device' });
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(<AuthProvider initialCredentials={null}><React.Fragment /></AuthProvider>);
        writeControl.afterWrite = async (key) => {
            if (!key.startsWith('auth_credentials')) return;
            writeControl.afterWrite = null;
            await getCurrentAuth()!.logout();
        };
        try {
            await act(async () => {
                await expect(getCurrentAuth()!.loginWithCredentials({ token: buildTokenWithSub('synthetic'), secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })).rejects.toThrow('Authentication cancelled');
            });
            expect(getCurrentAuth()!.isAuthenticated).toBe(false);
        } finally { writeControl.afterWrite = null; await screen.unmount(); }
    });

    it('keeps newer credentials when an older login is cancelled during its final writes', async () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
        const { upsertAndActivateServer, getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'https://password-newer.test', scope: 'device' });
        const expectedActiveServerSnapshot = getActiveServerSnapshot();
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const newerCredentials = { token: buildTokenWithSub('newer'), secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
        let isStillValid = true;
        /** 模拟安全存储回调完成前已有新的登录提交，旧操作只负责撤销自己的 token。 */
        writeControl.afterWrite = async (key) => {
            if (!key.startsWith('auth_auto_redirect_suppressed_until')) return;
            writeControl.afterWrite = null;
            await TokenStorage.setCredentials(newerCredentials);
            isStillValid = false;
        };
        try {
            await expect(TokenStorage.setCredentials(
                { token: buildTokenWithSub('older'), secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
                { expectedActiveServerSnapshot, isStillValid: () => isStillValid },
            )).rejects.toThrow('Authentication cancelled');
            expect(await TokenStorage.getCredentials()).toEqual(newerCredentials);
        } finally { writeControl.afterWrite = null; }
    });

    it('resolves without waiting for syncSwitchServer to finish', async () => {
        // Make sync's initial HTTP work hang so `syncSwitchServer` cannot complete until timers advance.
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'http://localhost:53288', scope: 'device' });

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');

        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: null,
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');

            await act(async () => {
                await auth.login(buildTokenWithSub('server-test'), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
            });
            await vi.advanceTimersByTimeAsync(1);
        } finally {
            await screen.unmount();
        }
    });

    it('keeps the mobile brand hero dismissed after logout', async () => {
        const seenAt = 1_789_222_000_000;
        const { localSettingsDefaults } = await import('@/sync/domains/settings/localSettings');
        const { clearPersistence, loadLocalSettings, saveLocalSettings } = await import('@/sync/domains/state/persistence');
        await clearPersistence();
        saveLocalSettings({
            ...localSettingsDefaults,
            brandHeroSeenAt: seenAt,
        });

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');

        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: { token: buildTokenWithSub('server-test'), secret: 'secret-test' },
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');

            await act(async () => {
                await auth.logout();
            });

            expect(loadLocalSettings().brandHeroSeenAt).toBe(seenAt);
        } finally {
            await screen.unmount();
            await clearPersistence();
        }
    });
});
