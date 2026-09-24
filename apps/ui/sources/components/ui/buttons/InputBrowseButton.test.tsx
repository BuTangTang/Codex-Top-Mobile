import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { InputBrowseButton } from './InputBrowseButton';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

/**
 * RUX-9.3 — visible disabled state on the path-picker browse button. The
 * button previously rendered identical pixels regardless of `disabled`,
 * so users had no visual cue that "no machine bound → cannot browse" was
 * causing the press to no-op. We now lower the opacity AND set
 * `cursor: not-allowed` on web. Accessibility state is forwarded so AT
 * users still get the message.
 */
describe('InputBrowseButton (RUX-9.3 disabled visuals)', () => {
    it('lowers opacity to a clearly-distinct value when disabled (vs the resting state)', async () => {
        const enabledScreen = await renderScreen(
            <InputBrowseButton testID="bb-enabled" onPress={() => {}} disabled={false} />,
        );
        const disabledScreen = await renderScreen(
            <InputBrowseButton testID="bb-disabled" onPress={() => {}} disabled={true} />,
        );
        const enabledNode = enabledScreen.findByTestId('bb-enabled');
        const disabledNode = disabledScreen.findByTestId('bb-disabled');
        const enabledStyle = flattenStyle(enabledNode!.props.style, { pressed: false });
        const disabledStyle = flattenStyle(disabledNode!.props.style, { pressed: false });
        const disabledOpacity = disabledStyle.opacity as number;
        const enabledOpacity = enabledStyle.opacity as number;
        expect(typeof disabledOpacity).toBe('number');
        expect(typeof enabledOpacity).toBe('number');
        expect(disabledOpacity).toBeLessThan(enabledOpacity);
        // Visibly distinct: disabled opacity is at most ~0.5 so the user
        // immediately reads the button as inactive.
        expect(disabledOpacity).toBeLessThanOrEqual(0.5);
    });

    it('applies cursor:not-allowed on web when disabled (clear visual cue)', async () => {
        const screen = await renderScreen(
            <InputBrowseButton testID="bb" onPress={() => {}} disabled={true} />,
        );
        const node = screen.findByTestId('bb');
        const style = flattenStyle(node!.props.style, { pressed: false });
        // The web flavor uses cursor: 'not-allowed' so the user gets the
        // standard browser affordance for "this control cannot be activated".
        // Native ignores `cursor` (no-op), so this is a web-only enhancement
        // shipped via Platform.select on the source.
        expect(style.cursor).toBe('not-allowed');
    });

    it('does not apply cursor:not-allowed when enabled', async () => {
        const screen = await renderScreen(
            <InputBrowseButton testID="bb" onPress={() => {}} disabled={false} />,
        );
        const node = screen.findByTestId('bb');
        const style = flattenStyle(node!.props.style, { pressed: false });
        expect(style.cursor).not.toBe('not-allowed');
    });

    it('forwards accessibilityState.disabled to assistive tech', async () => {
        const screen = await renderScreen(
            <InputBrowseButton testID="bb" onPress={() => {}} disabled={true} />,
        );
        const node = screen.findByTestId('bb');
        // RN Pressable maps `disabled` to `accessibilityState.disabled`. We
        // accept either prop shape so the test is resilient to minor RN
        // version drift.
        const a11yDisabled =
            node!.props.accessibilityState?.disabled === true || node!.props.disabled === true;
        expect(a11yDisabled).toBe(true);
    });
});

function flattenStyle(
    style: unknown,
    pressableState: { pressed: boolean },
): Record<string, unknown> {
    if (typeof style === 'function') {
        return flattenStyle((style as (s: { pressed: boolean }) => unknown)(pressableState), pressableState);
    }
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.flat(Infinity).filter(Boolean).map((s) =>
            typeof s === 'function' ? (s as (s: { pressed: boolean }) => unknown)(pressableState) : s,
        ));
    }
    return (style ?? {}) as Record<string, unknown>;
}
