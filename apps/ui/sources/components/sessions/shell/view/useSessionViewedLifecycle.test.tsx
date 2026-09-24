import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import {
    clearActiveViewingSessionsForServerScopeReset,
    getActiveViewingSessionId,
    isSessionVisible,
} from '@/sync/domains/session/activeViewingSession';
import { resetSessionManualUnreadHoldsForTests } from '@/sync/domains/session/readState/sessionManualUnreadHold';

import { useSessionViewedLifecycle } from './useSessionViewedLifecycle';

type ScopedViewedLifecycleInput = Parameters<typeof useSessionViewedLifecycle>[0] & Readonly<{
    serverId?: string | null;
}>;

vi.mock('@react-navigation/native', () => ({
    useFocusEffect: (effect: () => void | (() => void)) => {
        React.useEffect(() => {
            const cleanup = effect();
            return () => {
                cleanup?.();
            };
        }, [effect]);
    },
}));

describe('useSessionViewedLifecycle', () => {
    beforeEach(() => {
        resetSessionManualUnreadHoldsForTests();
        clearActiveViewingSessionsForServerScopeReset();
    });

    afterEach(() => {
        standardCleanup();
        clearActiveViewingSessionsForServerScopeReset();
    });

    it('tracks focused viewing activation without owning surface visibility', async () => {
        const hook = await renderHook((input: ScopedViewedLifecycleInput) => {
            useSessionViewedLifecycle(input);
            return null;
        }, {
            initialProps: {
                sessionId: 'shared-session',
                serverId: 'server-a',
                surfaceFocused: true,
                visibleReadSeq: null,
            } satisfies ScopedViewedLifecycleInput,
        });

        expect(getActiveViewingSessionId()).toBe('shared-session');
        expect(isSessionVisible('shared-session', 'server-a')).toBe(false);

        await hook.unmount();

        expect(getActiveViewingSessionId()).toBeNull();
        expect(isSessionVisible('shared-session', 'server-a')).toBe(false);
    });
});
