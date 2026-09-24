import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
import { getActiveServerSnapshot, upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { registerStorageStateReader } from '@/sync/domains/state/storageStateReaderBridge';
import { clearPendingNotificationNav, getPendingNotificationNav } from '@/sync/domains/pending/pendingNotificationNav';
import type { StorageState } from '@/sync/store/types';
let useNotificationResponseRouting: typeof import('./useNotificationResponseRouting').useNotificationResponseRouting;

const boundary = vi.hoisted(() => ({ authenticated: true, scope: null as { serverId: string; accountId: string } | null,
    navigate: vi.fn(), push: vi.fn(), alert: vi.fn(), hydrate: vi.fn(), listener: null as null | ((response: unknown) => void),
    sessions: {} as Record<string, unknown>, approve: vi.fn(), deny: vi.fn(),
}));
installSessionShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({ Platform: { OS: 'android' } });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ router: { navigate: boundary.navigate, push: boundary.push } }).module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({ storage: { getState: () => ({ sessions: boundary.sessions }) }, useActiveServerAccountScope: () => boundary.scope });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { alert: boundary.alert } }).module;
    },
});
vi.mock('@/auth/context/AuthContext', () => ({ getCurrentAuth: () => ({ isAuthenticated: boundary.authenticated }) }));
vi.mock('@/sync/sync', () => ({ sync: { ensureSessionVisibleForMessageRoute: (...args: unknown[]) => boundary.hydrate(...args) } }));
vi.mock('@/sync/ops', () => ({ sessionAllow: boundary.approve, sessionDeny: boundary.deny }));
vi.mock('@/utils/platform/loadExpoNotifications', () => ({ loadExpoNotifications: async () => ({
    DEFAULT_ACTION_IDENTIFIER: 'default', getLastNotificationResponseAsync: async () => null,
    addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => { boundary.listener = listener; return { remove: () => { boundary.listener = null; } }; },
}) }));
const target = { accountId: 'account-a', machineId: 'machine-a', notificationIdentity: 'a'.repeat(64) };
/** 合成推送不含正文，真正导航前仍走作用域和元数据验证。 */
function response(actionIdentifier = 'default') {
    return { actionIdentifier, notification: { request: { identifier: 'event-a', content: { data: { ...target, interaction: 'open_only', serverUrl: 'https://notify.test', sessionId: 'session-a' } } } } };
}
/** 包裹真实 hook，登录切换通过重新渲染模拟外部账号状态边界。 */
function Harness({ authenticated }: { authenticated: boolean }) {
    useNotificationResponseRouting({ enabled: authenticated, refreshAuth: async () => {} }); return null;
}
beforeEach(async () => {
    const { Platform } = await import('react-native'); Platform.OS = 'android';
    ({ useNotificationResponseRouting } = await import('./useNotificationResponseRouting'));
    vi.clearAllMocks();
    const profile = upsertAndActivateServer({ serverUrl: 'https://notify.test', scope: 'device' });
    boundary.scope = { serverId: profile.id, accountId: 'account-a' }; boundary.authenticated = true;
    registerStorageStateReader(() => ({ profileScope: boundary.scope } as unknown as StorageState));
    clearPendingNotificationNav();
    boundary.sessions = { 'session-a': { metadata: { directSessionV1: { v: 1, providerId: 'codex', machineId: 'machine-a', remoteSessionId: 'original-thread', source: { kind: 'codexHome', home: 'user' }, notificationStateV1: { identity: target.notificationIdentity } } } } };
    boundary.hydrate.mockResolvedValue({ kind: 'available', sessionId: 'session-a' });
});
describe('notification account routing', () => {
    it('retains an unauthenticated target, ignores another account, and restores only the owner', async () => {
        boundary.authenticated = false; boundary.scope = null;
        const screen = await renderScreen(<Harness authenticated={false} />);
        await act(async () => { boundary.listener!(response()); });
        expect(boundary.hydrate).not.toHaveBeenCalled();
        boundary.authenticated = true; boundary.scope = { serverId: getActiveServerSnapshot().serverId, accountId: 'different' };
        await screen.update(<Harness authenticated />);
        expect(boundary.hydrate).not.toHaveBeenCalled();
        boundary.scope = { ...boundary.scope, accountId: 'account-a' };
        await screen.update(<Harness authenticated />);
        await act(async () => { await vi.waitFor(() => expect(boundary.hydrate).toHaveBeenCalledTimes(1)); });
        expect(boundary.navigate.mock.calls.some(([href]) => (typeof href === 'string' ? href : String(href.pathname)).includes('/session/'))).toBe(true);
        expect(getPendingNotificationNav()).toBeNull();
        expect(boundary.approve).not.toHaveBeenCalled(); expect(boundary.deny).not.toHaveBeenCalled();
        await screen.unmount();
    });
    it('does not navigate a delayed hydration after logout', async () => {
        let release!: (value: unknown) => void;
        boundary.hydrate.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const screen = await renderScreen(<Harness authenticated />);
        await act(async () => { boundary.listener!(response()); await vi.waitFor(() => expect(release).toBeTypeOf('function')); });
        boundary.authenticated = false; boundary.scope = null;
        await screen.update(<Harness authenticated={false} />);
        await act(async () => { release({ kind: 'available' }); });
        expect(boundary.navigate).not.toHaveBeenCalled();
        await screen.unmount();
    });
    it('retries the same notification after a network failure and deduplicates only a successful open', async () => {
        boundary.hydrate.mockRejectedValueOnce(new Error('offline'));
        const screen = await renderScreen(<Harness authenticated />);
        try {
            await act(async () => { boundary.listener!(response()); await vi.waitFor(() => expect(boundary.alert).toHaveBeenCalled()); });
            expect(boundary.navigate).not.toHaveBeenCalled();
            await act(async () => { boundary.listener!(response()); await vi.waitFor(() => expect(boundary.navigate).toHaveBeenCalled()); });
            expect(boundary.hydrate).toHaveBeenCalledTimes(2);
            const opened = boundary.navigate.mock.calls.length;
            await act(async () => { boundary.listener!(response()); });
            expect(boundary.navigate.mock.calls).toHaveLength(opened);
        } finally { await screen.unmount(); }
    });
    it('does not open a same-id session whose source identity changed', async () => {
        boundary.sessions = { 'session-a': { metadata: {} } };
        const screen = await renderScreen(<Harness authenticated />);
        await act(async () => { boundary.listener!(response()); await vi.waitFor(() => expect(boundary.hydrate).toHaveBeenCalled()); });
        expect(boundary.navigate).not.toHaveBeenCalled(); expect(boundary.alert).toHaveBeenCalled();
        await screen.unmount();
    });
});
