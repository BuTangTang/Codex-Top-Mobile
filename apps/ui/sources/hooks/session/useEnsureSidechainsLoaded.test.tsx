import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEnsureSidechainsLoaded } from './useEnsureSidechainsLoaded';
import { createDeferred, flushHookEffects, renderHook, renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const syncTuningState = vi.hoisted(() => ({
    sidechainDemandHydrationConcurrencyLimit: 2,
}));

const ensureSidechainMessagesLoadedSpy = vi.hoisted(() =>
    vi.fn<(sessionId: string, sidechainId: string) => Promise<'loaded' | 'not_ready' | 'in_flight'>>(
        async (_sessionId: string, _sidechainId: string) => 'loaded',
    ),
);

vi.mock('@/sync/sync', () => ({
    sync: {
        ensureSidechainMessagesLoaded: (sessionId: string, sidechainId: string) =>
            ensureSidechainMessagesLoadedSpy(sessionId, sidechainId),
        getSyncTuning: () => syncTuningState,
    },
}));

vi.mock('@/utils/system/fireAndForget', () => ({
    fireAndForget: (promise: Promise<unknown>) => {
        void promise;
    },
}));

function Harness(props: Parameters<typeof useEnsureSidechainsLoaded>[0]) {
    useEnsureSidechainsLoaded(props);
    return null;
}

describe('useEnsureSidechainsLoaded', () => {
    beforeEach(() => {
        ensureSidechainMessagesLoadedSpy.mockReset();
        syncTuningState.sidechainDemandHydrationConcurrencyLimit = 2;
        delete process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_RETRY_MS;
        delete process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_MAX_RETRIES;
    });

    async function waitForRetryCycle() {
        await act(async () => {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 30);
            });
        });
    }

    it('does not re-request the same sidechain when callers pass a new array instance', async () => {
        let tree: renderer.ReactTestRenderer | null = null;

        tree = (await renderScreen(<Harness enabled sessionId="session-1" sidechainIds={['sidechain-1']} />)).tree;

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
            tree!.update(
                <Harness enabled sessionId="session-1" sidechainIds={['sidechain-1']} />,
            );
        });

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(1);
    });

    it('returns idle when no sidechain can be requested', async () => {
        const hook = await renderHook(() =>
            useEnsureSidechainsLoaded({ enabled: false, sessionId: 'session-1', sidechainIds: ['sidechain-1'] }));

        expect(hook.getCurrent().status).toBe('idle');
        expect(hook.getCurrent().entries).toEqual([]);
        expect(ensureSidechainMessagesLoadedSpy).not.toHaveBeenCalled();
    });

    it('reports loading then loaded for a loaded empty sidechain', async () => {
        const deferred = createDeferred<'loaded' | 'not_ready' | 'in_flight'>();
        ensureSidechainMessagesLoadedSpy.mockReturnValueOnce(deferred.promise);

        const hook = await renderHook(() =>
            useEnsureSidechainsLoaded({ enabled: true, sessionId: 'session-1', sidechainIds: ['sidechain-1'] }));

        expect(hook.getCurrent().status).toBe('loading');
        expect(hook.getCurrent().bySidechainId['sidechain-1']?.status).toBe('loading');

        deferred.resolve('loaded');
        await flushHookEffects();

        expect(hook.getCurrent().status).toBe('loaded');
        expect(hook.getCurrent().bySidechainId['sidechain-1']?.status).toBe('loaded');
    });

    it('reports in_flight and re-polls when sync dedupes against another mounted caller', async () => {
        ensureSidechainMessagesLoadedSpy
            .mockResolvedValueOnce('in_flight')
            .mockResolvedValueOnce('loaded');

        const hook = await renderHook(() =>
            useEnsureSidechainsLoaded({ enabled: true, sessionId: 'session-1', sidechainIds: ['sidechain-1'] }));

        await flushHookEffects();

        expect(hook.getCurrent().status).toBe('in_flight');
        expect(hook.getCurrent().bySidechainId['sidechain-1']?.status).toBe('in_flight');

        await act(async () => {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 300);
            });
        });

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(2);

        await flushHookEffects();

        expect(hook.getCurrent().status).toBe('loaded');
        expect(hook.getCurrent().bySidechainId['sidechain-1']?.status).toBe('loaded');
    });

    it('continues polling in_flight sidechains beyond the not_ready retry cap', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_RETRY_MS = '10';
        process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_MAX_RETRIES = '1';
        ensureSidechainMessagesLoadedSpy
            .mockResolvedValueOnce('in_flight')
            .mockResolvedValueOnce('in_flight')
            .mockResolvedValueOnce('loaded');

        const hook = await renderHook(() =>
            useEnsureSidechainsLoaded({ enabled: true, sessionId: 'session-1', sidechainIds: ['sidechain-1'] }));

        await flushHookEffects();

        expect(hook.getCurrent().status).toBe('in_flight');

        await waitForRetryCycle();
        await waitForRetryCycle();

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(3);

        await flushHookEffects();

        expect(hook.getCurrent().status).toBe('loaded');
        expect(hook.getCurrent().bySidechainId['sidechain-1']?.status).toBe('loaded');
    });

    it('does not let in_flight polling consume the not_ready retry budget', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_RETRY_MS = '10';
        process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_MAX_RETRIES = '1';
        ensureSidechainMessagesLoadedSpy
            .mockResolvedValueOnce('in_flight')
            .mockResolvedValueOnce('in_flight')
            .mockResolvedValueOnce('not_ready')
            .mockResolvedValueOnce('loaded');

        const hook = await renderHook(() =>
            useEnsureSidechainsLoaded({ enabled: true, sessionId: 'session-1', sidechainIds: ['sidechain-1'] }));

        await flushHookEffects();
        await waitForRetryCycle();
        await waitForRetryCycle();

        expect(hook.getCurrent().status).toBe('retrying');

        await waitForRetryCycle();

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(4);

        await flushHookEffects();

        expect(hook.getCurrent().status).toBe('loaded');
        expect(hook.getCurrent().bySidechainId['sidechain-1']?.status).toBe('loaded');
    });

    it('reports retrying while a transient not_ready result is scheduled for retry', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_RETRY_MS = '10';
        ensureSidechainMessagesLoadedSpy
            .mockResolvedValueOnce('not_ready')
            .mockResolvedValueOnce('loaded');

        const hook = await renderHook(() =>
            useEnsureSidechainsLoaded({ enabled: true, sessionId: 'session-1', sidechainIds: ['sidechain-1'] }));

        await flushHookEffects();

        expect(hook.getCurrent().status).toBe('retrying');
        expect(hook.getCurrent().bySidechainId['sidechain-1']?.status).toBe('retrying');

        await waitForRetryCycle();

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(2);

        await flushHookEffects();

        expect(hook.getCurrent().status).toBe('loaded');
    });

    it('retries the same sidechain automatically after a transient not_ready result', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_RETRY_MS = '10';
        ensureSidechainMessagesLoadedSpy
            .mockResolvedValueOnce('not_ready')
            .mockResolvedValueOnce('loaded');

        await renderScreen(<Harness enabled sessionId="session-1" sidechainIds={['sidechain-1']} />);

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalled();

        await waitForRetryCycle();

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(2);
    });

    it('stops retrying after the configured max retry count', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_RETRY_MS = '1';
        process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_MAX_RETRIES = '2';
        ensureSidechainMessagesLoadedSpy.mockResolvedValue('not_ready');

        await renderScreen(<Harness enabled sessionId="session-1" sidechainIds={['sidechain-1']} />);

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(1);

        await waitForRetryCycle();

        await waitForRetryCycle();

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(3);
    });

    it('bounds multi-sidechain request fanout within one hook instance', async () => {
        syncTuningState.sidechainDemandHydrationConcurrencyLimit = 2;
        const deferredRequests = new Map<string, ReturnType<typeof createDeferred<'loaded' | 'not_ready' | 'in_flight'>>>();
        ensureSidechainMessagesLoadedSpy.mockImplementation(async (_sessionId, sidechainId) => {
            const deferred = createDeferred<'loaded' | 'not_ready' | 'in_flight'>();
            deferredRequests.set(sidechainId, deferred);
            return deferred.promise;
        });

        const hook = await renderHook(() =>
            useEnsureSidechainsLoaded({
                enabled: true,
                sessionId: 'session-1',
                sidechainIds: ['sidechain-1', 'sidechain-2', 'sidechain-3', 'sidechain-4'],
            }));

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().status).toBe('loading');

        deferredRequests.get('sidechain-1')?.resolve('loaded');
        await flushHookEffects();

        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenCalledTimes(3);
        expect(ensureSidechainMessagesLoadedSpy).toHaveBeenLastCalledWith('session-1', 'sidechain-3');
    });
});
