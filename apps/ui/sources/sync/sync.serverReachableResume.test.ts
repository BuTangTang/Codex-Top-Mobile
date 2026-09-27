import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred } from '@/dev/testkit/hooks/createDeferred';

const platformState = vi.hoisted(() => ({ os: 'web' }));
const appStateHandlers = vi.hoisted(() => new Set<(state: string) => void>());
const nativeNetwork = vi.hoisted(() => {
    const listeners = new Set<(state: { isConnected?: boolean }) => void>();
    return {
        listeners,
        addNetworkStateListener: vi.fn((listener: (state: { isConnected?: boolean }) => void) => {
            listeners.add(listener);
            return { remove: () => listeners.delete(listener) };
        }),
        getNetworkStateAsync: vi.fn(),
        emit(state: { isConnected?: boolean }) {
            listeners.forEach((listener) => listener(state));
        },
    };
});

vi.mock('expo-network', () => nativeNetwork);

const appStateAddListener = vi.hoisted(() => vi.fn((_event: string, handler: (state: string) => void) => {
    appStateHandlers.add(handler);
    return { remove: () => appStateHandlers.delete(handler) };
}));
const apiSocketMock = vi.hoisted(() => {
    let connectionStateListener: ((state: import('@happier-dev/connection-supervisor').ManagedConnectionState) => void) | null = null;
    return {
        onMessage: vi.fn(),
        onError: vi.fn(),
        onReconnected: vi.fn(),
        onStatusChange: vi.fn(() => () => {}),
        onConnectionStateChange: vi.fn((listener: (state: import('@happier-dev/connection-supervisor').ManagedConnectionState) => void) => {
            connectionStateListener = listener;
            return () => {
                if (connectionStateListener === listener) {
                    connectionStateListener = null;
                }
            };
        }),
        connect: vi.fn(),
        disconnect: vi.fn(),
        initialize: vi.fn(),
        request: vi.fn(async () => new Response('ok', { status: 200 })),
        publishConnectionState(state: import('@happier-dev/connection-supervisor').ManagedConnectionState) {
            if (!connectionStateListener) {
                throw new Error('apiSocket.onConnectionStateChange was not subscribed');
            }
            connectionStateListener(state);
        },
    };
});
const reachabilityMock = vi.hoisted(() => ({
    invalidateAllServerReachabilitySupervisors: vi.fn(async () => {}),
}));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                        Platform: { get OS() { return platformState.os; } },
                        AppState: {
                            currentState: 'active',
                            addEventListener: appStateAddListener as any,
                        },
                    }
    );
});

vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: apiSocketMock,
}));

vi.mock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool')>();
    return {
        ...actual,
        invalidateAllServerReachabilitySupervisors: reachabilityMock.invalidateAllServerReachabilitySupervisors,
    };
});

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('sync server-reachable resume', () => {
    beforeEach(() => {
        vi.resetModules();
        platformState.os = 'web';
        appStateHandlers.clear();
        nativeNetwork.listeners.clear();
        nativeNetwork.addNetworkStateListener.mockClear();
        nativeNetwork.getNetworkStateAsync.mockClear();
        appStateAddListener.mockClear();
        apiSocketMock.onConnectionStateChange.mockClear();
        apiSocketMock.connect.mockClear();
        apiSocketMock.disconnect.mockClear();
        reachabilityMock.invalidateAllServerReachabilitySupervisors.mockReset().mockResolvedValue();
    });

    afterEach(async () => {
        const pool = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool');
        await pool.resetServerReachabilitySupervisors();
        (await import('@/utils/system/runtimeFetch')).resetRuntimeFetch();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // CT39：前台冷开后没有先到 false 事件，正向网络提示也应打断旧退避；真正在线仍由认证探测决定。
    it('wakes native cold-offline backoff on the first positive network event and waits for the real probe', async () => {
        platformState.os = 'android';
        vi.useFakeTimers();
        vi.setSystemTime(0);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const { sync } = await import('./sync');
        const { storage } = await import('@/sync/domains/state/storage');
        const pool = await vi.importActual<typeof import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool')>(
            '@/sync/runtime/connectivity/serverReachabilitySupervisorPool',
        );
        reachabilityMock.invalidateAllServerReachabilitySupervisors.mockImplementation(pool.invalidateAllServerReachabilitySupervisors);
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        const fetchProbe = vi.fn<Parameters<typeof setRuntimeFetch>[0]>().mockRejectedValue(new TypeError('Network request failed'));
        setRuntimeFetch(fetchProbe);
        const resume = vi.spyOn(sync, 'resumeSync').mockResolvedValue();
        const serverUrl = 'https://network-recovery.example.test';
        const unsubscribe = pool.subscribeServerReachabilityState(serverUrl, apiSocketMock.publishConnectionState);
        try {
            await pool.startServerReachabilitySupervisor({ serverUrl, token: 'synthetic-token' });
            for (let attempt = 1; attempt < 7; attempt++) {
                const retryAt = pool.peekServerReachabilityState(serverUrl)?.nextRetryAt;
                expect(retryAt).toBeTypeOf('number');
                await vi.advanceTimersByTimeAsync(retryAt! - Date.now());
            }
            const offline = pool.peekServerReachabilityState(serverUrl)!;
            expect(offline.phase).toBe('offline');
            expect(offline.nextRetryAt! - Date.now()).toBeGreaterThan(30_000);
            expect(storage.getState().endpointStatus).toBe('offline');
            const probesBeforeRecovery = fetchProbe.mock.calls.length;
            const probeReply = createDeferred<Response>();
            fetchProbe.mockReturnValue(probeReply.promise);

            nativeNetwork.emit({ isConnected: true });
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchProbe).toHaveBeenCalledTimes(probesBeforeRecovery + 1);
            expect(pool.peekServerReachabilityState(serverUrl)?.phase).not.toBe('online');
            expect(storage.getState().endpointStatus).toBe('offline');
            expect(resume).not.toHaveBeenCalled();
            expect(nativeNetwork.getNetworkStateAsync).not.toHaveBeenCalled();

            probeReply.resolve(new Response(null, { status: 200 }));
            await vi.advanceTimersByTimeAsync(0);
            expect(storage.getState().endpointStatus).toBe('online');
            expect(resume).toHaveBeenCalledExactlyOnceWith('server-reachable');
            // 同一系统事件簇仍使用原 invalidation 合并，不建另一份连接或重试循环。
            nativeNetwork.emit({ isConnected: true });
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchProbe).toHaveBeenCalledTimes(probesBeforeRecovery + 1);
        } finally {
            unsubscribe();
        }
    });

    it.each(['background', 'inactive'])('does not probe for a positive native event while %s', async (state) => {
        platformState.os = 'android';
        await import('./sync');
        const pool = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool');
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        const fetchProbe = vi.fn<Parameters<typeof setRuntimeFetch>[0]>();
        setRuntimeFetch(fetchProbe);
        pool.subscribeServerReachabilityState('https://network-recovery.example.test', () => {});
        appStateHandlers.forEach((handler) => handler(state));

        nativeNetwork.emit({ isConnected: true });
        await Promise.resolve();
        expect(reachabilityMock.invalidateAllServerReachabilitySupervisors).not.toHaveBeenCalled();
        expect(fetchProbe).not.toHaveBeenCalled();
    });

    it('keeps one native listener through singleton reuse and account-scoped resets without active state reads', async () => {
        platformState.os = 'android';
        const { sync } = await import('./sync');
        expect((await import('./sync')).sync).toBe(sync);
        sync.disconnectServer();
        sync.disconnectServer();
        expect(nativeNetwork.addNetworkStateListener).toHaveBeenCalledTimes(1);
        expect(nativeNetwork.listeners.size).toBe(1);
        nativeNetwork.emit({});
        nativeNetwork.emit({ isConnected: false });
        expect(reachabilityMock.invalidateAllServerReachabilitySupervisors).not.toHaveBeenCalled();
        nativeNetwork.emit({ isConnected: true });
        expect(reachabilityMock.invalidateAllServerReachabilitySupervisors).toHaveBeenCalledTimes(1);
        expect(nativeNetwork.getNetworkStateAsync).not.toHaveBeenCalled();
    });

    it('leaves web recovery with its existing online listener', async () => {
        await import('./sync');
        nativeNetwork.emit({ isConnected: true });
        expect(nativeNetwork.addNetworkStateListener).not.toHaveBeenCalled();
        expect(reachabilityMock.invalidateAllServerReachabilitySupervisors).not.toHaveBeenCalled();
        expect(nativeNetwork.getNetworkStateAsync).not.toHaveBeenCalled();
    });

    it('stores api socket reachability and resumes sync when the server becomes reachable again', async () => {
        const now = Date.now();
        const offlineState: import('@happier-dev/connection-supervisor').ManagedConnectionState = {
            phase: 'offline',
            reason: 'server_unreachable',
            attempt: 2,
            nextRetryAt: now + 1000,
            lastConnectedAt: null,
            lastDisconnectedAt: now,
            lastErrorMessage: 'Network request failed',
        };
        const onlineState: import('@happier-dev/connection-supervisor').ManagedConnectionState = {
            phase: 'online',
            reason: null,
            attempt: 2,
            nextRetryAt: null,
            lastConnectedAt: now + 1000,
            lastDisconnectedAt: now,
            lastErrorMessage: null,
        };

        const { sync } = await import('./sync');
        const { storage } = await import('@/sync/domains/state/storage');
        const resumeSpy = vi.fn(async () => {});
        (sync as unknown as { resumeSync: (reason: string) => Promise<void> }).resumeSync = resumeSpy;

        apiSocketMock.publishConnectionState(offlineState);
        expect(storage.getState().endpointStatus).toBe('offline');
        expect(storage.getState().endpointAttempt).toBe(2);
        expect(storage.getState().endpointLastErrorMessage).toBe('Network request failed');

        apiSocketMock.publishConnectionState(onlineState);
        await new Promise<void>((resolve) => queueMicrotask(resolve));

        expect(storage.getState().endpointStatus).toBe('online');
        expect(resumeSpy).toHaveBeenCalledWith('server-reachable');
    });

    it('manual retry forces reachability invalidation before resuming sync', async () => {
        const { sync } = await import('./sync');
        const resumeSpy = vi.fn(async () => {});
        (sync as unknown as { resumeSync: (reason: string) => Promise<void> }).resumeSync = resumeSpy;

        sync.retryNow();

        expect(apiSocketMock.disconnect).toHaveBeenCalledTimes(1);
        expect(apiSocketMock.connect).toHaveBeenCalledTimes(1);
        expect(reachabilityMock.invalidateAllServerReachabilitySupervisors).toHaveBeenCalledTimes(1);
        expect(resumeSpy).toHaveBeenCalledWith('manual');
    });

    it('manual retry still invalidates reachability when socket reconnect throws', async () => {
        const { sync } = await import('./sync');
        const resumeSpy = vi.fn(async () => {});
        (sync as unknown as { resumeSync: (reason: string) => Promise<void> }).resumeSync = resumeSpy;
        apiSocketMock.disconnect.mockImplementationOnce(() => {
            throw new Error('disconnect failed');
        });

        sync.retryNow();

        expect(reachabilityMock.invalidateAllServerReachabilitySupervisors).toHaveBeenCalledTimes(1);
        expect(resumeSpy).toHaveBeenCalledWith('manual');
    });
});
