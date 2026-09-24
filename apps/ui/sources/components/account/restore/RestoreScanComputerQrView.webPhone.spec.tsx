import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    installRestoreScanComputerQrViewCommonModuleMocks,
    resetRestoreScanComputerQrViewCommonModuleMockState,
} from './restoreScanComputerQrViewTestHelpers';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

const navigationState = vi.hoisted(() => ({
    isFocused: true,
    listeners: new Set<() => void>(),
    push: vi.fn(),
}));
const modalAlertSpy = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));

installRestoreScanComputerQrViewCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ router: { push: navigationState.push } }).module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { alertAsync: modalAlertSpy } }).module;
    },
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            ScrollView: 'ScrollView',
            ActivityIndicator: 'ActivityIndicator',
            Platform: {
                OS: 'web',
                select: (options: any) => options?.web ?? options?.default ?? options?.ios ?? options?.android,
            },
        });
    },
    reactNavigation: async () => {
        const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
        return {
            ...createReactNavigationNativeMock(),
            useIsFocused: () => React.useSyncExternalStore((listener) => { navigationState.listeners.add(listener); return () => { navigationState.listeners.delete(listener); }; }, () => navigationState.isFocused),
        };
    },
});

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => ({ state: 'enabled' }),
}));

vi.mock('@/utils/platform/platform', () => ({
    isRunningOnMac: () => false,
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ login: vi.fn(async () => {}), refreshFromActiveServer: vi.fn(async () => {}) }),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => ({ serverId: 'server-b' }) }));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerUrl: () => 'https://stack.example.test',
}));

vi.mock('@/sync/api/account/apiPairingAuth', () => ({
    pairingRequest: vi.fn(async () => ({ ok: false, reason: 'not_found', status: 404 })),
}));

vi.mock('@/auth/flows/qrStart', () => ({
    generateAuthKeyPair: () => ({ publicKey: new Uint8Array([1]), secretKey: new Uint8Array([2]) }),
    authQRStart: vi.fn(async () => true),
}));

vi.mock('@/auth/flows/qrWait', () => ({
    authQRWait: vi.fn(async () => null),
}));

vi.mock('@/encryption/base64', () => ({
    encodeBase64: () => 'x',
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    normalizeServerUrl: (s: string) => s,
    upsertActivateAndSwitchServer: vi.fn(async () => {}),
}));

vi.mock('@/auth/pairing/pairingUrl', () => ({
    buildPairingDeepLink: () => 'happier:///pair?v=1&pairId=p&secret=s',
    parsePairingDeepLink: () => null,
}));

let lastScannerProps: any = null;
vi.mock('@/components/qr/QrCodeScannerView', () => ({
    QrCodeScannerView: (props: any) => {
        lastScannerProps = props;
        return React.createElement('div', { 'data-testid': 'QrCodeScannerView' });
    },
}));

describe('RestoreScanComputerQrView (web phone)', () => {
    beforeEach(() => {
        vi.resetModules();
        resetRestoreScanComputerQrViewCommonModuleMockState();
        navigationState.isFocused = true;
        navigationState.push.mockClear();
        lastScannerProps = null;
        modalAlertSpy.mockClear();
    });

    it('renders the QR scanner in idle state on web', async () => {
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        const screen = await renderScreen(<RestoreScanComputerQrView />);

        expect(screen.findByProps({ 'data-testid': 'QrCodeScannerView' })).toBeTruthy();
        expect(lastScannerProps?.testIDPrefix).toBe('restore-scan');
        expect(lastScannerProps?.active).toBe(true);
    });

    it('marks the QR scanner inactive when the restore route is covered by another screen', async () => {
        navigationState.isFocused = false;

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);

        expect(lastScannerProps?.active).toBe(false);
    });

    it('explains that an account-connect QR must be scanned from a signed-in device', async () => {
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);

        await act(async () => {
            await lastScannerProps?.onScan('happier:///account?abc123');
        });

        expect(modalAlertSpy).toHaveBeenCalledWith(
            'connect.restoreAccount',
            'connect.restoreQrInstructions',
            expect.any(Array),
        );
        expect(modalAlertSpy).not.toHaveBeenCalledWith('common.error', 'modals.invalidAuthUrl');
    });
    it.each([true, false])('提示框迟到结果只允许仍处于原焦点的页面跳转：%s', async (remainFocused) => {
        let closePrompt!: () => void;
        modalAlertSpy.mockImplementationOnce(async (...args: unknown[]) => new Promise<void>((resolve) => {
            closePrompt = () => {
                const buttons = args[2] as Array<{ onPress?: () => void }>;
                buttons[1].onPress?.();
                resolve();
            };
        }));
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        const screen = await renderScreen(<RestoreScanComputerQrView />);
        let pending!: Promise<void>;
        await act(async () => { pending = lastScannerProps.onScan('happier:///account?abc123'); });
        if (!remainFocused) {
            await act(async () => { navigationState.isFocused = false; navigationState.listeners.forEach((listener) => listener()); });
            // 即使返回相同页面，也不恢复旧提示框的导航权。
            await act(async () => { navigationState.isFocused = true; navigationState.listeners.forEach((listener) => listener()); });
        }
        await act(async () => { closePrompt(); await pending; });
        if (remainFocused) expect(navigationState.push).toHaveBeenCalledWith('/restore/show-qr');
        else expect(navigationState.push).not.toHaveBeenCalled();
        await screen.unmount();
    });
});
