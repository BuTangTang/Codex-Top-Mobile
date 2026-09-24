import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '../render/renderScreen';

describe('keyboard avoidance testkit', () => {
    it('creates mutable composer keyboard layout shared-value stand-ins', async () => {
        const {
            createMockComposerKeyboardLayout,
            setMockComposerAvailablePanelHeight,
            setMockComposerHeight,
            setMockComposerKeyboardLiveHeight,
            setMockComposerKeyboardSettledHeight,
            setMockComposerKeyboardSuppressed,
        } = await import('./keyboardAvoidance.tsx');

        const layout = createMockComposerKeyboardLayout({
            availablePanelHeight: 420,
            composerHeight: 96,
        });

        expect(layout.availablePanelHeight.value).toBe(420);
        expect(layout.composerHeight.value).toBe(96);

        setMockComposerKeyboardLiveHeight(layout, 300);
        setMockComposerKeyboardSettledHeight(layout, 280);
        setMockComposerHeight(layout, 112);
        setMockComposerAvailablePanelHeight(layout, 360);
        setMockComposerKeyboardSuppressed(layout, true);

        expect(layout.keyboardHeightLive.value).toBe(300);
        expect(layout.keyboardHeightForInset.value).toBe(280);
        expect(layout.composerHeight.value).toBe(112);
        expect(layout.availablePanelHeight.value).toBe(360);
        expect(layout.isKeyboardLiftSuppressed.value).toBe(true);
    });

    it('renders deterministic scaffold content and composer slots while capturing the layout contract', async () => {
        const {
            MockComposerKeyboardScaffold,
            createMockComposerKeyboardLayout,
        } = await import('./keyboardAvoidance');
        const { createMockComposerKeyboardScaffoldHarness } = await import('../harness/composerKeyboardScaffoldHarness');
        const harness = createMockComposerKeyboardScaffoldHarness();
        const layout = createMockComposerKeyboardLayout({ composerHeight: 80 });

        const screen = await renderScreen(
            <MockComposerKeyboardScaffold
                accessibilityLabel="Composer scaffold"
                composer={<React.Fragment><ComposerSlot /></React.Fragment>}
                composerTestID="mock-composer"
                contentTestID="mock-content"
                layout={layout}
                mode="session"
                testID="mock-scaffold"
                harness={harness}
            >
                <ContentSlot />
            </MockComposerKeyboardScaffold>,
        );

        expect(screen.findByTestId('mock-scaffold')).toBeTruthy();
        expect(screen.findByTestId('mock-content')).toBeTruthy();
        expect(screen.findByTestId('mock-composer')).toBeTruthy();
        expect(screen.findByType('ContentSlot')).toBeTruthy();
        expect(screen.findByType('ComposerSlot')).toBeTruthy();
        expect(harness.getLastRender()?.layout).toBe(layout);
        expect(harness.getLastRender()?.props.mode).toBe('session');
        expect(harness.getLastRender()?.props.accessibilityLabel).toBe('Composer scaffold');
    });
});

function ContentSlot() {
    return React.createElement('ContentSlot');
}

function ComposerSlot() {
    return React.createElement('ComposerSlot');
}
