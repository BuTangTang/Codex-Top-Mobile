import React from 'react';
import renderer from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createMockComposerKeyboardScaffoldHarness,
    invokeTestInstanceHandler,
    MockComposerKeyboardScaffold,
    renderScreen,
} from '@/dev/testkit';
import { installTranscriptCommonModuleMocks } from './transcriptTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const keyboardDismissMock = vi.fn();
const scaffoldHarness = createMockComposerKeyboardScaffoldHarness();
const deviceMetricsState = vi.hoisted(() => ({
    type: 'phone' as 'phone' | 'tablet',
}));

installTranscriptCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Keyboard: {
                addListener: () => ({ remove: () => {} }),
                dismiss: keyboardDismissMock,
            },
            Platform: {
                OS: 'android',
                select: (v: any) => v.android ?? v.native ?? v.default,
            },
            View: (props: any) => React.createElement('View', props, props.children),
            ScrollView: (props: any) => React.createElement('ScrollView', props, props.children),
        });
    },
});

vi.mock('@/utils/platform/responsive', () => ({
    useHeaderHeight: () => 0,
    useDeviceType: () => deviceMetricsState.type,
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-keyboard-controller', () => ({
    KeyboardAvoidingView: (props: any) => React.createElement('KeyboardAvoidingView', props, props.children),
    useKeyboardHandler: () => undefined,
    useReanimatedKeyboardAnimation: () => ({
        height: { value: 0 },
        progress: { value: 0 },
    }),
}));

vi.mock('react-native-reanimated', async () => {
    const React = await import('react');
    return {
        __esModule: true,
        default: {
            View: (props: any) => React.createElement('AnimatedView', props, props.children),
            ScrollView: (props: any) => React.createElement('AnimatedScrollView', props, props.children),
        },
        useAnimatedStyle: (fn: any) => fn(),
        useSharedValue: (initial: any) => ({ value: initial }),
    };
});

vi.mock('@/components/sessions/keyboardAvoidance', () => ({
    ComposerKeyboardScaffold: (props: React.ComponentProps<typeof MockComposerKeyboardScaffold>) =>
        <MockComposerKeyboardScaffold {...props} harness={scaffoldHarness} />,
}));

describe('AgentContentView (android keyboard)', () => {
    beforeEach(() => {
        keyboardDismissMock.mockReset();
        scaffoldHarness.clear();
        deviceMetricsState.type = 'phone';
    });

    it.each([
        { deviceType: 'phone' as const, expectedInset: 0 },
        { deviceType: 'tablet' as const, expectedInset: 96 },
    ])('uses stable scaffold slots and the effective chrome inset on first $deviceType render', async ({ deviceType, expectedInset }) => {
        deviceMetricsState.type = deviceType;
        const { AgentContentView } = await import('./AgentContentView.native');
        const { SessionCockpitBottomChromeHeightContext } = await import('@/components/workspaceCockpit/session/SessionCockpitChromeRegistry');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(
            <SessionCockpitBottomChromeHeightContext.Provider value={96}>
                <AgentContentView
                    content={<React.Fragment>content</React.Fragment>}
                    input={<React.Fragment>input</React.Fragment>}
                    placeholder={<React.Fragment>placeholder</React.Fragment>}
                />
            </SessionCockpitBottomChromeHeightContext.Provider>,
        )).tree;

        expect(tree!.root.findAllByType('KeyboardAvoidingView' as any)).toHaveLength(0);
        const scaffold = tree!.root.findByType('MockComposerKeyboardScaffold' as any);
        expect(scaffold.props.testID).toBe('agent-content-keyboard-host');
        expect(scaffold.props.mode).toBe('session');
        const scaffoldRender = scaffoldHarness.getLastRender();
        expect(scaffoldRender?.props.mode).toBe('session');
        expect(scaffoldRender?.props.contentTestID).toBe('agent-content-scroll-region');
        expect(scaffoldRender?.props.composerTestID).toBe('agent-content-input-footer');
        expect(scaffoldRender?.props.layoutBottomInset).toBe(expectedInset);
        const contentHost = tree!.root.findAllByType('View' as never).filter((node) => node.props.style?.paddingBottom !== undefined);
        expect(contentHost).toHaveLength(1);
        expect(contentHost[0].props.style.paddingBottom).toBe(expectedInset);

        const contentRegion = tree!.root.findByProps({ testID: 'agent-content-scroll-region' });
        expect(contentRegion).toBeTruthy();

        const inputFooter = tree!.root.findByProps({ testID: 'agent-content-input-footer' });
        expect(inputFooter).toBeTruthy();

        expect(tree!.findAllByType('AnimatedView' as any)).toHaveLength(0);
        expect(tree!.findAllByType('AnimatedScrollView' as any)).toHaveLength(0);
    });

    it('dismisses the keyboard when transcript content is tapped outside the composer', async () => {
        const { AgentContentView } = await import('./AgentContentView.native');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<AgentContentView
                    content={<React.Fragment>content</React.Fragment>}
                    input={<React.Fragment>input</React.Fragment>}
                    placeholder={<React.Fragment>placeholder</React.Fragment>}
                />)).tree;

        const contentContainer = tree!.root.findByProps({ testID: 'agent-content-scroll-region' });
        expect(contentContainer).toBeTruthy();

        invokeTestInstanceHandler(
            contentContainer!,
            'onTouchStart',
            { nativeEvent: { pageX: 16, pageY: 24 } },
            'agent-content-tap-start',
        );
        invokeTestInstanceHandler(
            contentContainer!,
            'onTouchEnd',
            { nativeEvent: { pageX: 16, pageY: 24 } },
            'agent-content-tap-end',
        );

        expect(keyboardDismissMock).toHaveBeenCalledTimes(1);
    });

    it('does not dismiss the keyboard when transcript content is scrolled', async () => {
        const { AgentContentView } = await import('./AgentContentView.native');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<AgentContentView
                    content={<React.Fragment>content</React.Fragment>}
                    input={<React.Fragment>input</React.Fragment>}
                    placeholder={<React.Fragment>placeholder</React.Fragment>}
                />)).tree;

        const contentContainer = tree!.root.findByProps({ testID: 'agent-content-scroll-region' });
        expect(contentContainer).toBeTruthy();

        invokeTestInstanceHandler(
            contentContainer!,
            'onTouchStart',
            { nativeEvent: { pageX: 16, pageY: 24 } },
            'agent-content-scroll-start',
        );
        invokeTestInstanceHandler(
            contentContainer!,
            'onTouchMove',
            { nativeEvent: { pageX: 16, pageY: 48 } },
            'agent-content-scroll-move',
        );
        invokeTestInstanceHandler(
            contentContainer!,
            'onTouchEnd',
            { nativeEvent: { pageX: 16, pageY: 48 } },
            'agent-content-scroll-end',
        );

        expect(keyboardDismissMock).not.toHaveBeenCalled();
    });
});
