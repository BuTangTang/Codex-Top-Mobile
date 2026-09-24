import * as React from 'react';
import { describe, expect, it } from 'vitest';

import {
    ComposerKeyboardFloatingInset,
    ComposerKeyboardProvider,
} from '@/components/sessions/keyboardAvoidance';
import { createMockComposerKeyboardLayout, renderScreen } from '@/dev/testkit';

function flattenStyle(style: unknown): Record<string, unknown> {
    const styles = Array.isArray(style) ? style : [style];
    return styles.reduce<Record<string, unknown>>((merged, entry) => {
        if (entry && typeof entry === 'object') {
            return { ...merged, ...(entry as Record<string, unknown>) };
        }
        return merged;
    }, {});
}

function readTranslateY(style: unknown): number | undefined {
    const transform = flattenStyle(style).transform;
    if (!Array.isArray(transform)) return undefined;
    for (const entry of transform) {
        if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).translateY === 'number') {
            return (entry as { translateY: number }).translateY;
        }
    }
    return undefined;
}

describe('ComposerKeyboardFloatingInset', () => {
    it('lifts the floating element with a compositor transform instead of a layout bottom animation', async () => {
        const layout = createMockComposerKeyboardLayout({ listBottomInset: 168 });

        const screen = await renderScreen(
            <ComposerKeyboardProvider layout={layout}>
                <ComposerKeyboardFloatingInset testID="floating-inset" baseBottom={12}>
                    <React.Fragment />
                </ComposerKeyboardFloatingInset>
            </ComposerKeyboardProvider>,
        );

        const node = screen.findByTestId('floating-inset');
        if (!node) {
            throw new Error('Expected floating inset to render.');
        }
        const flattened = flattenStyle(node.props.style);

        // The keyboard lift must come from a transform, not an animated layout `bottom`.
        expect(readTranslateY(node.props.style)).toBe(-168);
        expect(flattened.bottom).toBe(12);

        await screen.unmount();
    });

    it('keeps the floating element at its base bottom with no transform offset when the keyboard inset is zero', async () => {
        const layout = createMockComposerKeyboardLayout({ listBottomInset: 0 });

        const screen = await renderScreen(
            <ComposerKeyboardProvider layout={layout}>
                <ComposerKeyboardFloatingInset testID="floating-inset" baseBottom={12}>
                    <React.Fragment />
                </ComposerKeyboardFloatingInset>
            </ComposerKeyboardProvider>,
        );

        const node = screen.findByTestId('floating-inset');
        if (!node) {
            throw new Error('Expected floating inset to render.');
        }
        const flattened = flattenStyle(node.props.style);

        // -0 and 0 are positionally identical; normalize away the IEEE-754 signed zero.
        expect(readTranslateY(node.props.style)).toBeCloseTo(0);
        expect(flattened.bottom).toBe(12);

        await screen.unmount();
    });

    it('defaults the base bottom to zero when no baseBottom prop is provided', async () => {
        const layout = createMockComposerKeyboardLayout({ listBottomInset: 40 });

        const screen = await renderScreen(
            <ComposerKeyboardProvider layout={layout}>
                <ComposerKeyboardFloatingInset testID="floating-inset">
                    <React.Fragment />
                </ComposerKeyboardFloatingInset>
            </ComposerKeyboardProvider>,
        );

        const node = screen.findByTestId('floating-inset');
        if (!node) {
            throw new Error('Expected floating inset to render.');
        }
        const flattened = flattenStyle(node.props.style);

        expect(readTranslateY(node.props.style)).toBe(-40);
        expect(flattened.bottom).toBe(0);

        await screen.unmount();
    });
});
