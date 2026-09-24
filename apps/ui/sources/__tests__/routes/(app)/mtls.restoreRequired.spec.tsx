import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { installRouteRootCommonModuleMocks } from '../routeRootTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const replaceSpy = vi.hoisted(() => vi.fn());
const useLocalSearchParamsMock = vi.hoisted(() => vi.fn<() => { error?: string }>(() => ({ error: 'restore_required' })));

const expoRouterMock = createExpoRouterMock({
    router: { replace: replaceSpy },
    params: () => useLocalSearchParamsMock(),
});

installRouteRootCommonModuleMocks({
    router: () => expoRouterMock.module,
});

vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: (props: Record<string, unknown>) => React.createElement('AgentIcon', props),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        loginWithCredentials: vi.fn(async () => {}),
    }),
}));

describe('/mtls (restore required)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('routes to /restore when the server redirects with error=restore_required', async () => {
        replaceSpy.mockReset();
        useLocalSearchParamsMock.mockReturnValue({ error: 'restore_required' });

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');
        await renderScreen(<MtlsCallbackScreen />);
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(replaceSpy).toHaveBeenCalledWith('/restore');
    });

    it('falls back to window search params when the web router params are not hydrated yet', async () => {
        replaceSpy.mockReset();
        useLocalSearchParamsMock.mockReturnValue({});
        vi.stubGlobal('window', { location: { search: '?error=restore_required' } });

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');
        await renderScreen(<MtlsCallbackScreen />);
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(replaceSpy).toHaveBeenCalledWith('/restore');
    });
});
