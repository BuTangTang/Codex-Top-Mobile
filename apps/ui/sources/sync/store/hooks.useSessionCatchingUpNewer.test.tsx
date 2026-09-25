import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { useSessionCatchingUpNewer } from './hooks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_ID = 'cached-direct-session';

/** 用真实 store 的工作计数与连接事实构造缓存会话，不模拟额外刷新状态。 */
function seedCatchUpSession(options: { serverId?: string; direct?: boolean } = {}): void {
    storage.setState({
        profileScope: { serverId: 'server-1', accountId: 'account-1' },
        socketStatus: 'disconnected',
        endpointStatus: 'offline',
        sessionCatchUpNewerInFlight: { [SESSION_ID]: 1 },
        sessions: {
            [SESSION_ID]: {
                id: SESSION_ID,
                serverId: options.serverId ?? 'server-1',
                metadata: options.direct === false ? null : {
                    directSessionV1: {
                        v: 1, providerId: 'codex', machineId: 'machine-1', remoteSessionId: 'native-1',
                        source: { kind: 'codexHome', home: 'user' },
                    },
                },
            },
        },
    } as never);
}

describe('useSessionCatchingUpNewer direct connection presentation', () => {
    let previousState: ReturnType<typeof storage.getState>;

    beforeEach(() => { previousState = storage.getState(); });
    afterEach(() => {
        standardCleanup();
        storage.setState(previousState, true);
    });

    // 等待连接的缓存刷新不能显示成正在接收新正文，也不能清除原工作计数。
    it.each(['disconnected', 'connecting', 'error'] as const)('does not surface queued direct work while %s', async (socketStatus) => {
        seedCatchUpSession();
        storage.setState({ socketStatus });
        const hook = await renderHook(() => useSessionCatchingUpNewer(SESSION_ID));
        expect(hook.getCurrent()).toBe(false);
        expect(storage.getState().sessionCatchUpNewerInFlight[SESSION_ID]).toBe(1);
    });

    // 断网立即收起；恢复连接后只显示尚未结束的真实追赶，结束后恢复静止。
    it('reacts to disconnect and reconnect without losing the in-flight bracket', async () => {
        seedCatchUpSession();
        storage.setState({ socketStatus: 'connected', endpointStatus: 'online' });
        const hook = await renderHook(() => useSessionCatchingUpNewer(SESSION_ID));
        expect(hook.getCurrent()).toBe(true);
        await act(async () => { storage.setState({ socketStatus: 'disconnected', endpointStatus: 'offline' }); });
        expect(hook.getCurrent()).toBe(false);
        expect(storage.getState().sessionCatchUpNewerInFlight[SESSION_ID]).toBe(1);
        await act(async () => { storage.setState({ socketStatus: 'connected', endpointStatus: 'online' }); });
        expect(hook.getCurrent()).toBe(true);
        await act(async () => { storage.getState().endSessionCatchUpNewer(SESSION_ID); });
        expect(hook.getCurrent()).toBe(false);
    });

    // 端点已经确认离线时，不等待 socket 的稍后断开通知才停止刷新动效。
    it('honors confirmed endpoint offline before the socket disconnect event', async () => {
        seedCatchUpSession();
        storage.setState({ socketStatus: 'connected' });
        const hook = await renderHook(() => useSessionCatchingUpNewer(SESSION_ID));
        expect(hook.getCurrent()).toBe(false);
    });

    // 当前 socket 只代表当前服务器，不能覆盖其他服务器或 HTTP 正文的工作状态。
    it.each([{ serverId: 'server-2' }, { direct: false }])('preserves work outside the active direct transport: %j', async (options) => {
        seedCatchUpSession(options);
        const hook = await renderHook(() => useSessionCatchingUpNewer(SESSION_ID));
        expect(hook.getCurrent()).toBe(true);
    });

    // 在线也必须存在工作；禁用或未知会话仍保持无刷新提示。
    it('does not invent work from a connected socket', async () => {
        seedCatchUpSession();
        storage.setState({ socketStatus: 'connected', endpointStatus: 'online', sessionCatchUpNewerInFlight: {} });
        const hook = await renderHook(() => useSessionCatchingUpNewer(SESSION_ID));
        const disabled = await renderHook(() => useSessionCatchingUpNewer(SESSION_ID, false));
        const missing = await renderHook(() => useSessionCatchingUpNewer('missing'));
        expect(hook.getCurrent()).toBe(false);
        expect(disabled.getCurrent()).toBe(false);
        expect(missing.getCurrent()).toBe(false);
    });
});
