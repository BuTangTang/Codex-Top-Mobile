import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';

const boundary = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn(), login: vi.fn(), snapshot: { serverId: 'a', serverUrl: 'https://a.test', generation: 1 } }));
installSessionShellCommonModuleMocks({ router: async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { push: boundary.push } }).module;
} });
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ loginWithCredentials: boundary.login }) }));
vi.mock('@/sync/http/client', () => ({ serverFetch: (...args: unknown[]) => boundary.fetch(...args) }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => boundary.snapshot, subscribeActiveServer: () => () => {} }));
vi.mock('@/components/ui/navigation/BrandLogo', () => ({ BrandLogo: 'BrandLogo' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

beforeEach(() => {
    boundary.fetch.mockReset().mockResolvedValue(new Response('{}', { status: 401 }));
    boundary.login.mockReset();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
});
describe('PhonePasswordLoginView', () => {
    it('keeps the form editable after rejection, toggles password visibility, and never authenticates', async () => {
        const { PhonePasswordLoginView } = await import('./PhonePasswordLoginView');
        const screen = await renderScreen(<PhonePasswordLoginView />);
        /** 每次从当前树读取必需控件，缺失时明确失败，避免空值和过期实例掩盖界面回归。 */
        const requireControl = (testId: string) => {
            const control = screen.findByTestId(testId);
            if (!control) throw new Error(`Required login control missing: ${testId}`);
            return control;
        };
        expect(requireControl('phone-login-submit').props.disabled).toBe(true);
        await act(async () => {
            requireControl('phone-login-name').props.onChangeText('colleague');
            requireControl('phone-login-password').props.onChangeText('correct horse');
        });
        await act(async () => { requireControl('phone-login-password-toggle').props.onPress(); });
        expect(requireControl('phone-login-password').props.secureTextEntry).toBe(false);
        await act(async () => { requireControl('phone-login-submit').props.onPress(); await vi.waitFor(() => expect(boundary.fetch).toHaveBeenCalledTimes(1)); });
        expect(boundary.fetch).toHaveBeenCalledTimes(1);
        expect(boundary.login).not.toHaveBeenCalled();
        expect(requireControl('phone-login-password').props.value).toBe('correct horse');
        expect(screen.findByTestId('phone-login-error')).toBeTruthy();
        await screen.unmount();
    });
});
