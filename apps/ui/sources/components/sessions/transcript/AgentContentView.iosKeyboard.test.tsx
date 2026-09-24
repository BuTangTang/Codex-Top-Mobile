import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
    createMockComposerKeyboardScaffoldHarness,
    MockComposerKeyboardScaffold,
    renderScreen,
} from '@/dev/testkit';
import { installTranscriptCommonModuleMocks } from './transcriptTestHelpers';


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const scaffoldHarness = createMockComposerKeyboardScaffoldHarness();
const bottomChromeMetricsState = vi.hoisted(() => ({
    height: 0,
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
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({
        top: safeAreaMetricsState.top,
        bottom: safeAreaMetricsState.bottom,
        left: 0,
        right: 0,
    }),
}));

vi.mock('@/components/workspaceCockpit/session/SessionCockpitChromeRegistry', () => ({
    useSessionCockpitBottomChromeHeight: () => bottomChromeMetricsState.height,
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
    it('uses the composer keyboard scaffold instead of whole-container keyboard avoidance on iOS', async () => {
        scaffoldHarness.clear();
        bottomChromeMetricsState.height = 80;
        safeAreaMetricsState.bottom = 0;
        safeAreaMetricsState.top = 0;
        const { AgentContentView } = await import('./AgentContentView.native');

        const { tree } = await renderScreen(
            <AgentContentView
                content={<React.Fragment>content</React.Fragment>}
                input={<React.Fragment>input</React.Fragment>}
                placeholder={<React.Fragment>placeholder</React.Fragment>}
            />,
        );

        expect(tree.root.findAllByType('KeyboardAvoidingView' as never)).toHaveLength(0);
        const scaffold = tree.root.findByType('MockComposerKeyboardScaffold' as never);
        expect(scaffold.props.testID).toBe('agent-content-keyboard-host');
        expect(scaffold.props.mode).toBe('session');
        const scaffoldRender = scaffoldHarness.getLastRender();
        expect(scaffoldRender?.props.mode).toBe('session');
        expect(scaffoldRender?.props.contentTestID).toBe('agent-content-scroll-region');
        expect(scaffoldRender?.props.composerTestID).toBe('agent-content-input-footer');
        expect(scaffoldRender?.props.layoutBottomInset).toBe(80);
    });

    it('uses the full bottom chrome height for the session scaffold inset even when safe area is injected separately', async () => {
        scaffoldHarness.clear();
        bottomChromeMetricsState.height = 80;
        safeAreaMetricsState.bottom = 8;
        safeAreaMetricsState.top = 0;
        const { AgentContentView } = await import('./AgentContentView.native');

        await renderScreen(
            <AgentContentView
                content={<React.Fragment>content</React.Fragment>}
                input={<React.Fragment>input</React.Fragment>}
                safeAreaBottom={0}
            />,
        );

        const scaffoldRender = scaffoldHarness.getLastRender();
        expect(scaffoldRender?.props.safeAreaBottom).toBe(0);
        expect(scaffoldRender?.props.layoutBottomInset).toBe(80);
    });
});
