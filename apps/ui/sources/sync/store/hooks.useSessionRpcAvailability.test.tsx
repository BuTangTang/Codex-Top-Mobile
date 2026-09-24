import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSessionRpcAvailabilityState', () => {
    afterEach(() => {
        storage.setState({
            sessions: {},
            isDataReady: true,
        } as never);
        standardCleanup();
    });

    it('does not rerender when session updates do not change existence or active state', async () => {
        storage.setState({
            sessions: {
                s1: {
                    id: 's1',
                    active: true,
                    metadata: {
                        path: '/workspace',
                    },
                },
            },
            isDataReady: true,
        } as never);

        const hooks = await import('./hooks') as typeof import('./hooks') & {
            useSessionRpcAvailabilityState?: (
                sessionId: string | null,
            ) => Readonly<{ sessionExists: boolean; sessionRpcAvailable: boolean }>;
        };
        expect(hooks.useSessionRpcAvailabilityState).toBeTypeOf('function');

        let renderCount = 0;
        const hook = await renderHook(() => {
            renderCount += 1;
            return hooks.useSessionRpcAvailabilityState?.('s1') ?? null;
        });

        expect(hook.getCurrent()).toEqual({
            sessionExists: true,
            sessionRpcAvailable: true,
        });
        expect(renderCount).toBe(1);

        await act(async () => {
            const previousSession = storage.getState().sessions.s1;
            storage.setState({
                sessions: {
                    s1: {
                        ...previousSession,
                        thinking: true,
                        thinkingAt: 789,
                    },
                },
            } as never);
        });

        expect(hook.getCurrent()).toEqual({
            sessionExists: true,
            sessionRpcAvailable: true,
        });
        expect(renderCount).toBe(1);

        await hook.unmount();
    });
});
