import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, createSessionFixture, flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';

import { useHydrateSessionForRoute } from './useHydrateSessionForRoute';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type EnsureRouteResult =
    | { kind: 'available'; sessionId: string; serverId?: string }
    | { kind: 'missing'; sessionId: string; serverId?: string; cause: 'not_found' | 'unauthorized' | 'forbidden' | 'auth_unavailable' }
    | { kind: 'retryable_failure'; sessionId: string; serverId?: string; cause: 'network' | 'server_unavailable' | 'decrypting' | 'unknown' };

const ensureSessionVisibleForMessageRouteSpy = vi.hoisted(() =>
    vi.fn<(sessionId: string, options?: Readonly<{ serverId?: string; forceRefresh?: boolean }>) => Promise<EnsureRouteResult>>(),
);
const getSessionEncryptionSpy = vi.hoisted(() => vi.fn<(sessionId: string) => unknown>());
const activeServerSnapshotMock = vi.hoisted(() => ({
    current: {
        serverId: '',
        serverUrl: '',
        activeShareableServerUrl: null,
        activeLocalRelayUrl: null,
        generation: 0,
    },
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => activeServerSnapshotMock.current,
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        ensureSessionVisibleForMessageRoute: (sessionId: string, options?: Readonly<{ serverId?: string; forceRefresh?: boolean }>) =>
            ensureSessionVisibleForMessageRouteSpy(sessionId, options),
        encryption: {
            getSessionEncryption: (sessionId: string) => getSessionEncryptionSpy(sessionId),
        },
    },
}));

vi.mock('@/utils/system/fireAndForget', () => ({
    fireAndForget: (promise: Promise<unknown>) => {
        void promise.catch(() => {});
    },
}));

function availableResult(sessionId: string, serverId?: string): EnsureRouteResult {
    return serverId
        ? { kind: 'available', sessionId, serverId }
        : { kind: 'available', sessionId };
}

function missingResult(
    sessionId: string,
    cause: 'not_found' | 'unauthorized' | 'forbidden' | 'auth_unavailable',
    serverId?: string,
): EnsureRouteResult {
    return serverId
        ? { kind: 'missing', sessionId, serverId, cause }
        : { kind: 'missing', sessionId, cause };
}

function retryableResult(
    sessionId: string,
    cause: 'network' | 'server_unavailable' | 'decrypting' | 'unknown',
    serverId?: string,
): EnsureRouteResult {
    return serverId
        ? { kind: 'retryable_failure', sessionId, serverId, cause }
        : { kind: 'retryable_failure', sessionId, cause };
}

async function storeHydratedSession(sessionId: string, serverId?: string): Promise<void> {
    getSessionEncryptionSpy.mockImplementation((candidateSessionId) =>
        candidateSessionId === sessionId ? { decryptMetadata: vi.fn(), decryptAgentState: vi.fn() } : null,
    );
    await act(async () => {
        storage.setState((state) => ({
            ...state,
            sessions: {
                ...state.sessions,
                [sessionId]: createSessionFixture({
                    id: sessionId,
                    serverId,
                    agentState: { controlledByUser: true },
                    encryptionMode: 'e2ee',
                }),
            },
        }));
    });
}

async function storeHydratedSessionWithNullAgentState(sessionId: string, serverId?: string): Promise<void> {
    getSessionEncryptionSpy.mockImplementation((candidateSessionId) =>
        candidateSessionId === sessionId ? { decryptMetadata: vi.fn(), decryptAgentState: vi.fn() } : null,
    );
    await act(async () => {
        storage.setState((state) => ({
            ...state,
            sessions: {
                ...state.sessions,
                [sessionId]: createSessionFixture({
                    id: sessionId,
                    serverId,
                    agentState: null,
                    encryptionMode: 'e2ee',
                }),
            },
        }));
    });
}

describe('useHydrateSessionForRoute', () => {
    let previousStorageState: ReturnType<typeof storage.getState>;

    beforeEach(() => {
        previousStorageState = storage.getState();
        ensureSessionVisibleForMessageRouteSpy.mockReset();
        ensureSessionVisibleForMessageRouteSpy.mockResolvedValue(retryableResult('session-1', 'unknown'));
        getSessionEncryptionSpy.mockReset();
        activeServerSnapshotMock.current = {
            serverId: '',
            serverUrl: '',
            activeShareableServerUrl: null,
            activeLocalRelayUrl: null,
            generation: 0,
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        standardCleanup();
        storage.setState(previousStorageState, true);
    });

    it('starts a cold route in loading state', async () => {
        const deferred = createDeferred<EnsureRouteResult>();
        ensureSessionVisibleForMessageRouteSpy.mockReturnValueOnce(deferred.promise);

        const hook = await renderHook(() => useHydrateSessionForRoute('session-1', 'route.hydrate'));

        expect(hook.getCurrent()).toMatchObject({
            kind: 'loading',
            sessionId: 'session-1',
        });
        expect(ensureSessionVisibleForMessageRouteSpy).toHaveBeenCalledWith('session-1', undefined);
    });

    it('becomes available only after the session exists authoritatively in the store', async () => {
        const deferred = createDeferred<EnsureRouteResult>();
        ensureSessionVisibleForMessageRouteSpy.mockReturnValueOnce(deferred.promise);

        const hook = await renderHook(() => useHydrateSessionForRoute('session-1', 'route.hydrate'));

        await act(async () => {
            deferred.resolve(availableResult('session-1'));
        });
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(hook.getCurrent()).toMatchObject({
            kind: 'loading',
            sessionId: 'session-1',
        });

        await storeHydratedSession('session-1');
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(hook.getCurrent()).toEqual({
            kind: 'available',
            sessionId: 'session-1',
        });
    });

    it.each(['not_found', 'unauthorized', 'forbidden'] as const)(
        'maps terminal %s hydration results to missing state',
        async (cause) => {
            ensureSessionVisibleForMessageRouteSpy.mockResolvedValueOnce(missingResult('session-1', cause));

            const hook = await renderHook(() => useHydrateSessionForRoute('session-1', 'route.hydrate'));
            await flushHookEffects({ cycles: 1, turns: 1 });

            expect(hook.getCurrent()).toEqual({
                kind: 'missing',
                sessionId: 'session-1',
                cause,
            });
        },
    );

    it('keeps retryable hydration failures non-terminal and retries', async () => {
        vi.useFakeTimers();
        const retryDeferred = createDeferred<EnsureRouteResult>();
        ensureSessionVisibleForMessageRouteSpy
            .mockResolvedValueOnce(retryableResult('session-1', 'network'))
            .mockReturnValueOnce(retryDeferred.promise);

        const hook = await renderHook(() => useHydrateSessionForRoute('session-1', 'route.hydrate'));
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(hook.getCurrent()).toEqual({
            kind: 'retrying',
            sessionId: 'session-1',
            cause: 'network',
        });

        await flushHookEffects({ cycles: 1, turns: 1, advanceTimersMs: 2_000 });

        expect(ensureSessionVisibleForMessageRouteSpy).toHaveBeenCalledTimes(2);
        await act(async () => {
            retryDeferred.resolve(retryableResult('session-1', 'server_unavailable'));
        });
    });

    it('resets state when the session id changes', async () => {
        await storeHydratedSession('session-1');

        const hook = await renderHook(
            (props: { sessionId: string }) => useHydrateSessionForRoute(props.sessionId, 'route.hydrate'),
            { initialProps: { sessionId: 'session-1' } },
        );

        expect(hook.getCurrent()).toEqual({
            kind: 'available',
            sessionId: 'session-1',
        });

        const nextRouteHydration = createDeferred<EnsureRouteResult>();
        ensureSessionVisibleForMessageRouteSpy.mockReturnValueOnce(nextRouteHydration.promise);
        await hook.rerender({ sessionId: 'session-2' });

        expect(hook.getCurrent()).toMatchObject({
            kind: 'loading',
            sessionId: 'session-2',
        });
    });

    it('masks a terminal state from the previous route during the route identity switch render', async () => {
        ensureSessionVisibleForMessageRouteSpy.mockResolvedValueOnce(missingResult('missing-session', 'not_found'));

        const observedStates: Array<ReturnType<typeof useHydrateSessionForRoute>> = [];
        function Harness(props: Readonly<{ sessionId: string }>) {
            observedStates.push(useHydrateSessionForRoute(props.sessionId, 'route.hydrate'));
            return null;
        }

        let tree!: renderer.ReactTestRenderer;
        await act(async () => {
            tree = renderer.create(<Harness sessionId="missing-session" />);
        });
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(observedStates.at(-1)).toEqual({
            kind: 'missing',
            sessionId: 'missing-session',
            cause: 'not_found',
        });

        observedStates.length = 0;
        const nextRouteHydration = createDeferred<EnsureRouteResult>();
        ensureSessionVisibleForMessageRouteSpy.mockReturnValueOnce(nextRouteHydration.promise);
        await act(async () => {
            tree.update(<Harness sessionId="session-2" />);
        });

        expect(observedStates[0]).toEqual({
            kind: 'loading',
            sessionId: 'session-2',
            reason: 'store-miss',
        });
        await act(async () => {
            tree.unmount();
        });
    });

    it('ignores stale promise resolution from a prior route', async () => {
        const staleDeferred = createDeferred<EnsureRouteResult>();
        const currentDeferred = createDeferred<EnsureRouteResult>();
        ensureSessionVisibleForMessageRouteSpy
            .mockReturnValueOnce(staleDeferred.promise)
            .mockReturnValueOnce(currentDeferred.promise);

        const hook = await renderHook(
            (props: { sessionId: string }) => useHydrateSessionForRoute(props.sessionId, 'route.hydrate'),
            { initialProps: { sessionId: 'session-1' } },
        );

        await hook.rerender({ sessionId: 'session-2' });
        await act(async () => {
            staleDeferred.resolve(missingResult('session-1', 'not_found'));
        });
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(hook.getCurrent()).toMatchObject({
            kind: 'loading',
            sessionId: 'session-2',
        });
    });

    it('keeps a reload during active streaming non-terminal while hydration is pending', async () => {
        const deferred = createDeferred<EnsureRouteResult>();
        ensureSessionVisibleForMessageRouteSpy.mockReturnValueOnce(deferred.promise);

        const hook = await renderHook(() => useHydrateSessionForRoute('streaming-session', 'route.hydrate'));

        expect(hook.getCurrent()).toMatchObject({
            kind: 'loading',
            sessionId: 'streaming-session',
        });
    });

    it('can move an available route to missing after an authoritative forbidden refresh', async () => {
        await storeHydratedSession('session-1', 'server-a');
        ensureSessionVisibleForMessageRouteSpy.mockResolvedValueOnce(missingResult('session-1', 'forbidden', 'server-a'));

        const hook = await renderHook(
            (props: { forceRefresh: boolean }) =>
                useHydrateSessionForRoute('session-1', 'route.hydrate', { serverId: 'server-a', forceRefresh: props.forceRefresh }),
            { initialProps: { forceRefresh: false } },
        );

        expect(hook.getCurrent()).toEqual({
            kind: 'available',
            sessionId: 'session-1',
            serverId: 'server-a',
        });

        await hook.rerender({ forceRefresh: true });
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(hook.getCurrent()).toEqual({
            kind: 'missing',
            sessionId: 'session-1',
            serverId: 'server-a',
            cause: 'forbidden',
        });
    });

    it('keeps same-session cached re-entry available without starting hydration', async () => {
        await storeHydratedSession('session-1');

        const hook = await renderHook(() => useHydrateSessionForRoute('session-1', 'route.hydrate'));

        expect(hook.getCurrent()).toEqual({
            kind: 'available',
            sessionId: 'session-1',
        });
        expect(ensureSessionVisibleForMessageRouteSpy).not.toHaveBeenCalled();
    });

    it('keeps cached available route hydration state referentially stable across parent rerenders', async () => {
        await storeHydratedSession('session-1');

        const hook = await renderHook(
            (_props: { parentVersion: number }) => useHydrateSessionForRoute('session-1', 'route.hydrate'),
            { initialProps: { parentVersion: 1 } },
        );
        const initialState = hook.getCurrent();

        await hook.rerender({ parentVersion: 2 });

        expect(hook.getCurrent()).toBe(initialState);
        expect(ensureSessionVisibleForMessageRouteSpy).not.toHaveBeenCalled();
    });

    it('treats hydrated session metadata with null agent state as available', async () => {
        await storeHydratedSessionWithNullAgentState('session-1');

        const hook = await renderHook(() => useHydrateSessionForRoute('session-1', 'route.hydrate'));

        expect(hook.getCurrent()).toEqual({
            kind: 'available',
            sessionId: 'session-1',
        });
        expect(ensureSessionVisibleForMessageRouteSpy).not.toHaveBeenCalled();
    });

    it('does not reset a cached route to missing during a background resume rerender', async () => {
        await storeHydratedSession('session-1');

        const hook = await renderHook(
            (props: { tag: string }) => useHydrateSessionForRoute('session-1', props.tag),
            { initialProps: { tag: 'route.hydrate.bg' } },
        );

        await hook.rerender({ tag: 'route.hydrate.foreground' });

        expect(hook.getCurrent()).toEqual({
            kind: 'available',
            sessionId: 'session-1',
        });
        expect(ensureSessionVisibleForMessageRouteSpy).not.toHaveBeenCalled();
    });

    it('keeps an already hydrated active-server session available for an unknown route server alias', async () => {
        activeServerSnapshotMock.current = {
            serverId: 'server-actual',
            serverUrl: 'http://localhost',
            activeShareableServerUrl: null,
            activeLocalRelayUrl: null,
            generation: 0,
        };
        await storeHydratedSession('session-1', 'server-actual');

        const hook = await renderHook(() =>
            useHydrateSessionForRoute('session-1', 'route.hydrate', { serverId: 'stale-route-server' }),
        );

        expect(hook.getCurrent()).toEqual({
            kind: 'available',
            sessionId: 'session-1',
            serverId: 'server-actual',
        });
        expect(ensureSessionVisibleForMessageRouteSpy).not.toHaveBeenCalled();
    });

    it('accepts the hydrated server id when an unknown route server alias falls back to the active server', async () => {
        const deferred = createDeferred<EnsureRouteResult>();
        ensureSessionVisibleForMessageRouteSpy.mockReturnValueOnce(deferred.promise);

        const hook = await renderHook(() =>
            useHydrateSessionForRoute('session-1', 'route.hydrate', { serverId: 'stale-route-server' }),
        );

        await storeHydratedSession('session-1', 'server-actual');
        await act(async () => {
            deferred.resolve(availableResult('session-1', 'server-actual'));
        });
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(hook.getCurrent()).toEqual({
            kind: 'available',
            sessionId: 'session-1',
            serverId: 'server-actual',
        });
    });

    it('ignores stale in-flight hydration when the server scope changes', async () => {
        const staleDeferred = createDeferred<EnsureRouteResult>();
        const currentDeferred = createDeferred<EnsureRouteResult>();
        ensureSessionVisibleForMessageRouteSpy
            .mockReturnValueOnce(staleDeferred.promise)
            .mockReturnValueOnce(currentDeferred.promise);

        const hook = await renderHook(
            (props: { serverId: string }) =>
                useHydrateSessionForRoute('session-1', 'route.hydrate', { serverId: props.serverId }),
            { initialProps: { serverId: 'server-a' } },
        );

        await hook.rerender({ serverId: 'server-b' });
        await act(async () => {
            staleDeferred.resolve(missingResult('session-1', 'not_found', 'server-a'));
        });
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(hook.getCurrent()).toMatchObject({
            kind: 'loading',
            sessionId: 'session-1',
            serverId: 'server-b',
        });
        expect(ensureSessionVisibleForMessageRouteSpy).toHaveBeenLastCalledWith('session-1', { serverId: 'server-b' });
    });
});
