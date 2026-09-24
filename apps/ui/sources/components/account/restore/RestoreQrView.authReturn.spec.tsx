import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { installRestoreRouteCommonModuleMocks } from '@/__tests__/routes/(app)/restore/restoreRouteTestHelpers';

const state = vi.hoisted(() => ({
    serverId: 'server-b', focused: true,
    params: { id: 's1', serverId: 'server-b', authReturn: '1' },
    login: vi.fn(async () => {}), replace: vi.fn(), back: vi.fn(),
    listeners: new Set<() => void>(),
}));
installRestoreRouteCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ params: () => state.params, router: { replace: state.replace, back: state.back } }).module;
    },
    reactNavigation: async () => {
        const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
        return { ...createReactNavigationNativeMock(), useIsFocused: () => React.useSyncExternalStore((listener) => { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; }, () => state.focused) };
    },
});
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ login: state.login }) }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => ({ serverId: state.serverId }) }));
vi.mock('@/auth/flows/qrStart', () => ({ generateAuthKeyPair: () => ({ publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) }), authQRStart: async () => true }));
vi.mock('@/auth/flows/qrWait', () => ({ authQRWait: vi.fn(async () => ({ token: 'synthetic', secret: new Uint8Array(32) })) }));
vi.mock('@/encryption/base64', () => ({ encodeBase64: () => 'synthetic' }));
vi.mock('@/components/qr/QRCode', () => ({ QRCode: 'QRCode' }));
vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({ getReadyServerFeatures: async () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    state.serverId = 'server-b';
    state.focused = true;
    state.login.mockClear();
    state.replace.mockClear();
    state.back.mockClear();
    standardCleanup();
});

describe('展示二维码后的会话返回', () => {
    it.each(['server-b', 'server-c'])('只恢复实际登录来源 %s 的目标', async (serverId) => {
        state.serverId = serverId;
        const { RestoreQrView } = await import('./RestoreQrView');
        const screen = await renderScreen(<RestoreQrView />);
        await flushHookEffects();
        expect(state.login).toHaveBeenCalled();
        expect(state.replace).toHaveBeenCalledWith(serverId === 'server-b' ? '/?id=s1&serverId=server-b&authReturn=1' : '/');
        expect(state.back).not.toHaveBeenCalled();
        await screen.unmount();
    });
    it('失焦再回到同目标后旧二维码结果仍不得登录或回跳', async () => {
        let finish!: (value: { token: string; secret: Uint8Array }) => void;
        const { authQRWait } = await import('@/auth/flows/qrWait');
        vi.mocked(authQRWait).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const { RestoreQrView } = await import('./RestoreQrView');
        const screen = await renderScreen(<RestoreQrView />);
        await flushHookEffects();
        await act(async () => { state.focused = false; state.listeners.forEach((listener) => listener()); });
        vi.mocked(authQRWait).mockImplementationOnce(() => new Promise(() => {}));
        await act(async () => { state.focused = true; state.listeners.forEach((listener) => listener()); });
        await act(async () => { finish({ token: 'synthetic', secret: new Uint8Array(32) }); });
        await flushHookEffects();
        expect(state.login).not.toHaveBeenCalled();
        expect(state.replace).not.toHaveBeenCalled();
        expect(state.back).not.toHaveBeenCalled();
        await screen.unmount();
    });
});
