import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createMockComposerKeyboardScaffoldHarness,
    MockComposerKeyboardScaffold,
    renderScreen,
} from '@/dev/testkit';
import { installTranscriptCommonModuleMocks } from './transcriptTestHelpers';


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const scaffoldHarness = createMockComposerKeyboardScaffoldHarness();
const deviceMetricsState = vi.hoisted(() => ({
    type: 'phone' as 'phone' | 'tablet',
}));
const safeAreaMetricsState = vi.hoisted(() => ({
    bottom: 0,
    top: 0,
}));

installTranscriptCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Keyboard: {
                addListener: () => ({ remove: () => {} }),
                dismiss: vi.fn(),
            },
            Platform: {
                OS: 'ios',
                select: <T,>(values: { ios?: T; native?: T; default?: T }) =>
                    values.ios ?? values.native ?? values.default,
            },
            View: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('View', props, props.children),
        });
    },
});

vi.mock('@/utils/platform/responsive', () => ({
    useHeaderHeight: () => 0,
    useDeviceType: () => deviceMetricsState.type,
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({
        top: safeAreaMetricsState.top,
        bottom: safeAreaMetricsState.bottom,
        left: 0,
        right: 0,
    }),
}));

vi.mock('react-native-keyboard-controller', () => ({
    KeyboardAvoidingView: (
        props: Record<string, unknown> & { children?: React.ReactNode },
    ) => React.createElement('KeyboardAvoidingView', props, props.children),
}));

vi.mock('@/components/sessions/keyboardAvoidance', () => ({
    ComposerKeyboardScaffold: (props: React.ComponentProps<typeof MockComposerKeyboardScaffold>) =>
        <MockComposerKeyboardScaffold {...props} harness={scaffoldHarness} />,
}));

describe('AgentContentView (iOS keyboard)', () => {
    beforeEach(() => {
        scaffoldHarness.clear();
        deviceMetricsState.type = 'phone';
        safeAreaMetricsState.bottom = 0;
        safeAreaMetricsState.top = 0;
    });

    it('uses the phone scaffold with no stale chrome inset on its first render', async () => {
        const { AgentContentView } = await import('./AgentContentView.native');
        const { SessionCockpitBottomChromeHeightContext } = await import('@/components/workspaceCockpit/session/SessionCockpitChromeRegistry');

        const { tree } = await renderScreen(
            <SessionCockpitBottomChromeHeightContext.Provider value={96}>
                <AgentContentView
                    content={<React.Fragment>content</React.Fragment>}
                    input={<React.Fragment>input</React.Fragment>}
                    placeholder={<React.Fragment>placeholder</React.Fragment>}
                />
            </SessionCockpitBottomChromeHeightContext.Provider>,
        );

        expect(tree.root.findAllByType('KeyboardAvoidingView' as never)).toHaveLength(0);
        const scaffold = tree.root.findByType('MockComposerKeyboardScaffold' as never);
        expect(scaffold.props.testID).toBe('agent-content-keyboard-host');
        expect(scaffold.props.mode).toBe('session');
        const scaffoldRender = scaffoldHarness.getLastRender();
        expect(scaffoldRender?.props.mode).toBe('session');
        expect(scaffoldRender?.props.contentTestID).toBe('agent-content-scroll-region');
        expect(scaffoldRender?.props.composerTestID).toBe('agent-content-input-footer');
        expect(scaffoldRender?.props.layoutBottomInset).toBe(0);
        const contentHost = tree.root.findAllByType('View' as never).filter((node) => node.props.style?.paddingBottom !== undefined);
        expect(contentHost).toHaveLength(1);
        expect(contentHost[0].props.style.paddingBottom).toBe(0);
    });

    it('preserves the full non-phone chrome inset when safe area is injected separately', async () => {
        deviceMetricsState.type = 'tablet';
        safeAreaMetricsState.bottom = 8;
        const { AgentContentView } = await import('./AgentContentView.native');
        const { SessionCockpitBottomChromeHeightContext } = await import('@/components/workspaceCockpit/session/SessionCockpitChromeRegistry');

        const { tree } = await renderScreen(
            <SessionCockpitBottomChromeHeightContext.Provider value={80}>
                <AgentContentView
                    content={<React.Fragment>content</React.Fragment>}
                    input={<React.Fragment>input</React.Fragment>}
                    safeAreaBottom={0}
                />
            </SessionCockpitBottomChromeHeightContext.Provider>,
        );

        const scaffoldRender = scaffoldHarness.getLastRender();
        expect(scaffoldRender?.props.safeAreaBottom).toBe(0);
        expect(scaffoldRender?.props.layoutBottomInset).toBe(80);
        const contentHost = tree.root.findAllByType('View' as never).filter((node) => node.props.style?.paddingBottom !== undefined);
        expect(contentHost).toHaveLength(1);
        expect(contentHost[0].props.style.paddingBottom).toBe(80);
    });
});
