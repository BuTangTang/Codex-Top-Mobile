import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { installModalComponentCommonModuleMocks } from './modalComponentTestHelpers';

let useOverlayPortalForTest: typeof import('@/components/ui/popover')['useOverlayPortal'];

const nativeEnvironmentState = vi.hoisted(() => ({
    keyboard: { isVisible: false, height: 0 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
}));

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
    }
    return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/state/storage')>();
    return {
        ...actual,
        useLocalSetting: ((name: string) => {
            if (name === 'uiBackdropBlurEnabled') return true;
            return null;
        }) as typeof import('@/sync/domains/state/storage')['useLocalSetting'],
    };
});

vi.mock('@/components/ui/keyboardAvoidance', () => ({
    KeyboardAwareModalFrame: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('KeyboardAwareModalFrame', props, props.children),
}));

vi.mock('react-native-safe-area-context', async () => {
    const { createSafeAreaContextMock } = await import('@/dev/testkit/mocks/nativeEnvironment');
    return createSafeAreaContextMock(nativeEnvironmentState);
});

installModalComponentCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'ios',
                select: <T,>(options: { ios?: T; native?: T; default?: T; web?: T; android?: T }) =>
                    options.ios ?? options.native ?? options.default ?? options.web ?? options.android,
            },
        });
    },
});

describe('BaseModal (native keyboard frame)', () => {
    beforeEach(() => {
        nativeEnvironmentState.safeArea.top = 0;
        nativeEnvironmentState.safeArea.right = 0;
        nativeEnvironmentState.safeArea.bottom = 0;
        nativeEnvironmentState.safeArea.left = 0;
    });

    it('routes native modal content through the shared keyboard-aware modal frame', async () => {
        const { BaseModal } = await import('./BaseModal');

        const screen = await renderScreen(
            <BaseModal visible={true}>
                <Child />
            </BaseModal>,
        );

        expect(screen.findByType('KeyboardAwareModalFrame' as any).props.style).toBeDefined();
        expect(screen.findAllByType('KeyboardAvoidingView' as any)).toHaveLength(0);
    });

    it('keeps the keyboard-aware native modal frame inside safe area insets', async () => {
        nativeEnvironmentState.safeArea.top = 47;
        nativeEnvironmentState.safeArea.right = 9;
        nativeEnvironmentState.safeArea.bottom = 34;
        nativeEnvironmentState.safeArea.left = 7;
        const { BaseModal } = await import('./BaseModal');

        const screen = await renderScreen(
            <BaseModal visible={true}>
                <Child />
            </BaseModal>,
        );

        const style = flattenStyle(screen.findByType('KeyboardAwareModalFrame' as any).props.style);
        expect(style).toMatchObject({
            paddingTop: 47,
            paddingRight: 9,
            paddingBottom: 34,
            paddingLeft: 7,
        });
    });

    it('provides a modal-local native overlay portal for popovers opened inside the modal', async () => {
        const { BaseModal } = await import('./BaseModal');
        useOverlayPortalForTest = (await import('@/components/ui/popover')).useOverlayPortal;

        const screen = await renderScreen(
            <BaseModal visible={true}>
                <ModalPortalProbe />
            </BaseModal>,
        );
        await flushHookEffects();

        expect(screen.findByTestId('modal-local-portal-node')).toBeTruthy();
    });
});

function Child() {
    return React.createElement('Child');
}

function ModalPortalProbe() {
    const portal = useOverlayPortalForTest();

    React.useEffect(() => {
        portal?.setPortalNode('modal-local-node', React.createElement('ModalLocalPortalNode', {
            testID: 'modal-local-portal-node',
        }));
        return () => {
            portal?.removePortalNode('modal-local-node');
        };
    }, [portal]);

    return React.createElement('ModalPortalProbe');
}
