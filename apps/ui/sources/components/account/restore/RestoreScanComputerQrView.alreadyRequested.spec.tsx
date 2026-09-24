import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { installRestoreScanComputerQrViewCommonModuleMocks } from './restoreScanComputerQrViewTestHelpers';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    __DEV__?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as ReactActEnvironmentGlobal).__DEV__ = true;
type ExpoGlobalShim = NonNullable<typeof globalThis.expo>;
const expoShim = {
    EventEmitter: class {} as unknown as ExpoGlobalShim['EventEmitter'],
    SharedRef: class {} as unknown as ExpoGlobalShim['SharedRef'],
    SharedObject: class {} as unknown as ExpoGlobalShim['SharedObject'],
    NativeModule: class {} as unknown as ExpoGlobalShim['NativeModule'],
    modules: {} as ExpoGlobalShim['modules'],
} satisfies Partial<ExpoGlobalShim>;
(globalThis as typeof globalThis & { expo: ExpoGlobalShim }).expo = expoShim as ExpoGlobalShim;
process.env.EXPO_OS = 'web';

vi.mock('@/dev/reactNativeStub', async () => await import('../../../dev/reactNativeStub'));
vi.mock('@/dev/testkit/mocks/reactNative', async () => await import('../../../dev/testkit/mocks/reactNative'));
vi.mock('@/dev/testkit/mocks/router', async () => await import('../../../dev/testkit/mocks/router'));
vi.mock('@/dev/testkit/mocks/modal', async () => await import('../../../dev/testkit/mocks/modal'));
vi.mock('@/dev/testkit/mocks/text', async () => await import('../../../dev/testkit/mocks/text'));
vi.mock('@/dev/testkit/mocks/unistyles', async () => await import('../../../dev/testkit/mocks/unistyles'));
vi.mock('@/theme', async () => await import('../../../theme'));

const continuation = vi.hoisted(() => ({
    params: {} as Record<string, string>, serverId: 'server-b', focused: true,
    listeners: new Set<() => void>(),
    replace: vi.fn(), login: vi.fn(async () => {}),
}));
vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => ({ serverId: continuation.serverId }) }));

installRestoreScanComputerQrViewCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ params: () => continuation.params, router: { replace: continuation.replace } }).module;
    },
    reactNavigation: async () => {
        const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
        return { ...createReactNavigationNativeMock(), useIsFocused: () => React.useSyncExternalStore((listener) => { continuation.listeners.add(listener); return () => { continuation.listeners.delete(listener); }; }, () => continuation.focused) };
    },
    modal: async () => {
        const { createModalModuleMock } = await import('../../../dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alertAsync: modalAlertAsyncSpy,
                prompt: vi.fn(async () => null),
            },
        }).module;
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('../../../dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    surface: '#fff',
                    text: '#000',
                    textSecondary: '#666',
                    divider: '#ddd',
                    overlay: {
                        scrim: 'rgba(0,0,0,0.3)',
                        scrimStrong: 'rgba(0,0,0,0.55)',
                        text: '#fff',
                        textSecondary: 'rgba(255,255,255,0.85)',
                    },
                },
            },
        });
    },
});

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => ({ state: 'enabled' }),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ login: continuation.login, refreshFromActiveServer: vi.fn(async () => {}) }),
}));

const modalAlertAsyncSpy = vi.fn(async () => {});

vi.mock('expo-constants', () => ({
    default: {
        deviceName: undefined,
    },
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    getActiveServerUrl: () => 'https://stack.example.test',
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    normalizeServerUrl: (s: string) => s,
    upsertActivateAndSwitchServer: vi.fn(async () => {}),
}));

vi.mock('@/sync/domains/server/url/serverUrlOverridePolicy', () => ({
    resolveEffectiveServerUrlOverride: () => null,
}));

vi.mock('@/sync/domains/server/url/serverUrlClassification', () => ({
    isLoopbackServerUrl: () => false,
}));

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        mono: () => ({}),
    },
}));

vi.mock('@/auth/pairing/pairingUrl', () => ({
    buildPairingDeepLink: () => 'happier:///pair?v=1&pairId=p&secret=s',
    parsePairingDeepLink: () => ({ pairId: 'pair_123', secret: 'secret_123', serverUrl: null }),
}));

vi.mock('@/sync/api/account/apiPairingAuth', () => ({
    pairingRequest: vi.fn(async () => ({ ok: false, reason: 'already_requested', status: 401 })),
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

let lastScannerProps: any = null;
vi.mock('@/components/qr/QrCodeScannerView', () => ({
    QrCodeScannerView: (props: any) => {
        lastScannerProps = props;
        return React.createElement('QrCodeScannerView', props);
    },
}));

describe('RestoreScanComputerQrView (already requested)', () => {
    it('shows a friendly error when the pairing session already has a requested device', async () => {
        vi.resetModules();
        modalAlertAsyncSpy.mockClear();
        lastScannerProps = null;

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        let tree: ReactTestRenderer | null = null;
        try {
            await act(async () => {
                tree = create(<RestoreScanComputerQrView />);
            });
            if (!tree) throw new Error('Expected renderer');
            expect(typeof lastScannerProps?.onScan).toBe('function');

            await act(async () => {
                await lastScannerProps.onScan('happier:///pair?v=1&pairId=pair_123&secret=secret_123');
            });

            expect(modalAlertAsyncSpy).toHaveBeenCalledWith(
                'connect.pairingAlreadyRequestedTitle',
                'connect.pairingAlreadyRequestedBody',
            );
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });
});

describe('扫码登录恢复来源', () => {
    it.each(['server-b', 'server-c'])('完成时只保留当前来源 %s', async (serverId) => {
        vi.resetModules();
        continuation.params = { id: 's1', serverId: 'server-b', authReturn: '1' };
        continuation.serverId = serverId;
        continuation.focused = true;
        continuation.replace.mockClear();
        const { pairingRequest } = await import('@/sync/api/account/apiPairingAuth');
        vi.mocked(pairingRequest).mockResolvedValueOnce({ ok: true, data: { confirmCode: '123' } } as never);
        const { authQRWait } = await import('@/auth/flows/qrWait');
        vi.mocked(authQRWait).mockResolvedValueOnce({ token: 'test', secret: new Uint8Array(32) });
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        let tree: ReactTestRenderer | null = null;
        try {
            await act(async () => { tree = create(<RestoreScanComputerQrView />); });
            await act(async () => { await lastScannerProps.onScan('test'); });
            expect(continuation.replace).toHaveBeenLastCalledWith(serverId === 'server-b' ? '/?id=s1&serverId=server-b&authReturn=1' : '/');
        } finally { await act(async () => { tree?.unmount(); }); }
    });
    it('失焦再返回同目标时，旧扫码请求仍不得登录或回跳', async () => {
        vi.resetModules();
        continuation.focused = true;
        continuation.login.mockClear();
        continuation.replace.mockClear();
        const { pairingRequest } = await import('@/sync/api/account/apiPairingAuth');
        vi.mocked(pairingRequest).mockResolvedValueOnce({ ok: true, data: { confirmCode: '123' } } as never);
        let finish!: (value: { token: string; secret: Uint8Array }) => void;
        const { authQRWait } = await import('@/auth/flows/qrWait');
        vi.mocked(authQRWait).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        let tree: ReactTestRenderer | null = null;
        let request!: Promise<void>;
        try {
            await act(async () => { tree = create(<RestoreScanComputerQrView />); });
            await act(async () => { request = lastScannerProps.onScan('test'); });
            await act(async () => { continuation.focused = false; continuation.listeners.forEach((listener) => listener()); });
            await act(async () => { continuation.focused = true; continuation.listeners.forEach((listener) => listener()); });
            await act(async () => { finish({ token: 'test', secret: new Uint8Array(32) }); await request; });
            expect(continuation.login).not.toHaveBeenCalled();
            expect(continuation.replace).not.toHaveBeenCalled();
        } finally { await act(async () => { tree?.unmount(); }); continuation.focused = true; }
    });
});

it('配对请求等待期间换服不得把新服当作旧请求来源', async () => {
    vi.resetModules();
    continuation.serverId = 'server-b';
    continuation.focused = true;
    continuation.login.mockClear();
    continuation.replace.mockClear();
    let finish!: (value: unknown) => void;
    const { pairingRequest } = await import('@/sync/api/account/apiPairingAuth');
    vi.mocked(pairingRequest).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as never; }));
    const { authQRWait } = await import('@/auth/flows/qrWait');
    vi.mocked(authQRWait).mockResolvedValueOnce({ token: 'test', secret: new Uint8Array(32) });
    const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
    let tree: ReactTestRenderer | null = null;
    let request!: Promise<void>;
    try {
        await act(async () => { tree = create(<RestoreScanComputerQrView />); });
        await act(async () => { request = lastScannerProps.onScan('test'); });
        continuation.serverId = 'server-c';
        await act(async () => { finish({ ok: true, data: { confirmCode: '123' } }); await request; });
        expect(continuation.login).not.toHaveBeenCalled();
        expect(continuation.replace).not.toHaveBeenCalled();
    } finally { await act(async () => { tree?.unmount(); }); continuation.serverId = 'server-b'; }
});
