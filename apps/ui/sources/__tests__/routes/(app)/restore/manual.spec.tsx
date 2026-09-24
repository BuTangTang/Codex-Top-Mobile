import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installRestoreRouteCommonModuleMocks } from './restoreRouteTestHelpers';


type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

const routerBackSpy = vi.hoisted(() => vi.fn());
const routerReplaceSpy = vi.hoisted(() => vi.fn());
const routerDismissToSpy = vi.hoisted(() => vi.fn());
const authLoginSpy = vi.hoisted(() => vi.fn(async () => {}));
const continuationState = vi.hoisted(() => ({ params: {} as Record<string, string>, serverId: 'server-b', focused: true, listeners: new Set<() => void>() }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => ({ serverId: continuationState.serverId }) }));
const authState = vi.hoisted(() => ({ isAuthenticated: false }));
const normalizeSecretKeySpy = vi.hoisted(() => vi.fn((input: string) => input.trim()));

vi.mock('@expo/vector-icons/Ionicons', () => ({
    default: 'Ionicons',
}));

installRestoreRouteCommonModuleMocks({
    reactNavigation: async () => {
        const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
        return { ...createReactNavigationNativeMock(), useIsFocused: () => React.useSyncExternalStore((listener) => { continuationState.listeners.add(listener); return () => { continuationState.listeners.delete(listener); }; }, () => continuationState.focused) };
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            params: () => continuationState.params,
            router: { back: routerBackSpy, replace: routerReplaceSpy, dismissTo: routerDismissToSpy },
        });
        return routerMock.module;
    },
});

vi.mock('@/components/onboarding/unauthShell', async () => {
    const React = await import('react');
    return {
        UnauthenticatedSplitShell: (props: {
            children?: React.ReactNode;
            stepId: string;
            isWelcomeStep: boolean;
            allowMobileBrandHero?: boolean;
            onOpenRelayCustomFlow: () => void;
            onBrandHeroGetStarted: () => void;
            onBack?: () => void;
        }) =>
            React.createElement(
                'UnauthenticatedSplitShell',
                {
                    stepId: props.stepId,
                    isWelcomeStep: props.isWelcomeStep,
                    allowMobileBrandHero: props.allowMobileBrandHero,
                    hasBack: typeof props.onBack === 'function',
                    testID: `unauth-shell-route-${props.stepId}`,
                },
                props.children,
            ),
    };
});

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: authState.isAuthenticated,
        login: authLoginSpy,
    }),
}));

vi.mock('@/auth/flows/getToken', () => ({
    authGetToken: vi.fn(async () => 'token'),
}));

vi.mock('@/auth/recovery/secretKeyBackup', () => ({
    normalizeSecretKey: normalizeSecretKeySpy,
}));

vi.mock('@/encryption/base64', () => ({
    decodeBase64: vi.fn((_value: string, _encoding: string) => new Uint8Array(32)),
}));

vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: 'RoundButton',
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 1024 },
}));

afterEach(() => {
    authState.isAuthenticated = false;
    continuationState.params = {};
    continuationState.serverId = 'server-b';
    continuationState.focused = true;
    vi.restoreAllMocks();
    standardCleanup();
});

async function renderManualRestoreScreen() {
    vi.resetModules();
    const { default: Screen } = await import('@/app/(app)/restore/manual');
    return renderScreen(<Screen />);
}

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    }
    if (style && typeof style === 'object') {
        return style as Record<string, unknown>;
    }
    return {};
}

describe('/restore/manual', () => {
    it('renders manual secret-key restore inside the unauthenticated split shell without mobile hero', async () => {
        const screen = await renderManualRestoreScreen();

        const shell = screen.findByTestId('unauth-shell-route-restore-manual');
        expect(shell).toBeTruthy();
        expect(shell?.props.stepId).toBe('restore-manual');
        expect(shell?.props.isWelcomeStep).toBe(false);
        expect(shell?.props.allowMobileBrandHero).toBe(false);
        expect(shell?.props.hasBack).toBe(true);
    });

    it('renders manual secret-key restore without unauthenticated chrome when already signed in', async () => {
        authState.isAuthenticated = true;

        const screen = await renderManualRestoreScreen();

        expect(screen.findByTestId('unauth-shell-route-restore-manual')).toBeNull();
        expect(screen.findByTestId('restore-route-content')).not.toBeNull();
        expect(screen.findByTestId('restore-manual-secret-input')).not.toBeNull();
    });

    it('does not auto-capitalize secret key input (supports case-sensitive base64url input)', async () => {
        const screen = await renderManualRestoreScreen();
        const input = screen.findByTestId('restore-manual-secret-input');
        expect(input).not.toBeNull();
        expect(input?.props?.autoCapitalize).toBe('none');
    });

    it('renders the secret key input as a visible themed field surface', async () => {
        const screen = await renderManualRestoreScreen();
        const input = screen.findByTestId('restore-manual-secret-input');
        const inputStyle = flattenStyle(input?.props?.style);

        expect(inputStyle.borderWidth).toBe(1);
        expect(inputStyle.borderColor).toBeTruthy();
        expect(inputStyle.backgroundColor).toBeTruthy();
    });

    it('masks the secret key input by default and allows toggling visibility', async () => {
        const screen = await renderManualRestoreScreen();

        const input = screen.findByTestId('restore-manual-secret-input');
        expect(input).not.toBeNull();
        expect(input?.props?.secureTextEntry).toBe(true);
        expect(input?.props?.multiline).toBe(false);

        await screen.pressByTestIdAsync('restore-manual-secret-reveal');

        const revealedInput = screen.findByTestId('restore-manual-secret-input');
        expect(revealedInput?.props?.secureTextEntry).toBe(false);
    });

    it('dismisses to home after a successful restore without dispatching a nested replace action', async () => {
        const screen = await renderManualRestoreScreen();

        const submit = screen.findByTestId('restore-manual-submit');
        expect(submit).not.toBeNull();

        await act(async () => {
            screen.changeTextByTestId('restore-manual-secret-input', 'secret-key');
        });

        await act(async () => {
            await submit?.props?.action?.();
        });

        expect(authLoginSpy).toHaveBeenCalled();
        expect(normalizeSecretKeySpy).toHaveBeenCalled();
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(routerReplaceSpy).not.toHaveBeenCalled();
        expect(routerDismissToSpy).toHaveBeenCalledWith('/');
    });
});

describe('手机登录返回通知会话', () => {
    it.each(['server-b', 'server-c'])('恢复密钥完成时只返回相同来源：%s', async (serverId) => {
        continuationState.params = { id: 'same/id', serverId: 'server-b', authReturn: '1' };
        continuationState.serverId = serverId;
        const screen = await renderManualRestoreScreen();
        await act(async () => { screen.changeTextByTestId('restore-manual-secret-input', 'secret-key'); });
        await act(async () => { await screen.findByTestId('restore-manual-submit')?.props.action(); });
        expect(routerDismissToSpy).toHaveBeenLastCalledWith(serverId === 'server-b' ? '/?id=same%2Fid&serverId=server-b&authReturn=1' : '/');
    });
});

it('取消恢复后迟到token不得登录或回跳', async () => {
    const { authGetToken } = await import('@/auth/flows/getToken');
    let finish!: (token: string) => void;
    vi.mocked(authGetToken).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = await renderManualRestoreScreen();
    await act(async () => { screen.changeTextByTestId('restore-manual-secret-input', 'secret-key'); });
    let pending!: Promise<void>;
    await act(async () => { pending = screen.findByTestId('restore-manual-submit')?.props.action(); });
    await screen.unmount();
    authLoginSpy.mockClear();
    routerDismissToSpy.mockClear();
    await act(async () => { finish('test'); await pending; });
    expect(authLoginSpy).not.toHaveBeenCalled();
    expect(routerDismissToSpy).not.toHaveBeenCalled();
});

it('返回同一手动恢复页面也不能重新启用旧登录结果', async () => {
    const { authGetToken } = await import('@/auth/flows/getToken');
    let finish!: (token: string) => void;
    vi.mocked(authGetToken).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = await renderManualRestoreScreen();
    await act(async () => { screen.changeTextByTestId('restore-manual-secret-input', 'secret-key'); });
    let pending!: Promise<void>;
    await act(async () => { pending = screen.findByTestId('restore-manual-submit')?.props.action(); });
    await act(async () => { continuationState.focused = false; continuationState.listeners.forEach((listener) => listener()); });
    await act(async () => { continuationState.focused = true; continuationState.listeners.forEach((listener) => listener()); });
    authLoginSpy.mockClear();
    routerDismissToSpy.mockClear();
    await act(async () => { finish('test'); await pending; });
    expect(authLoginSpy).not.toHaveBeenCalled();
    expect(routerDismissToSpy).not.toHaveBeenCalled();
    await screen.unmount();
});
