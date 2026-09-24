import { describe, expect, it } from 'vitest';

import { darkTheme, lightTheme } from './theme';
import { BUILT_IN_THEME_PROFILES } from './theme/profiles/builtInThemeProfiles';
import { resolveThemeProfile } from './theme/profiles/resolveThemeProfile';

describe('control gradient theme tokens', () => {
    function hexLuminance(hex: string): number {
        const value = hex.replace('#', '');
        const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
        const [red, green, blue] = channels.map((channel) =>
            channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        );
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    }

    function expectVerticalGradientToBeLighterAtTop(colors: readonly [string, string, ...string[]], label?: string) {
        const bottomColor = colors[0];
        const topColor = colors[colors.length - 1];
        expect(
            hexLuminance(topColor) >= hexLuminance(bottomColor),
            label ? `${label}: expected top stop to be lighter than bottom stop` : undefined,
        ).toBe(true);
    }

    function expectColorToken(value: string | undefined) {
        expect(value).toMatch(/^(#[0-9A-Fa-f]{6}|rgba\()/);
    }

    function rgbaAlpha(value: string): number {
        const match = /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/.exec(value);
        expect(match, `Expected ${value} to be an rgba color`).not.toBeNull();
        return Number(match?.[1]);
    }

    it('defines subtle fallback-compatible gradients for FAB controls', () => {
        expect(lightTheme.colors.fab.gradient?.colors).toHaveLength(2);
        expect(darkTheme.colors.fab.gradient?.colors).toHaveLength(2);
        expectColorToken(lightTheme.colors.fab.background);
        expectColorToken(darkTheme.colors.fab.background);
        expect(darkTheme.colors.fab.gradient?.start).toEqual({ x: 0.5, y: 1 });
        expect(darkTheme.colors.fab.gradient?.end).toEqual({ x: 0.5, y: 0 });
    });

    it('defines segmented control gradients without replacing solid color fallbacks', () => {
        expectColorToken(lightTheme.colors.segmentedControl.trackBackground);
        expectColorToken(lightTheme.colors.segmentedControl.activeBackground);
        expect(lightTheme.colors.segmentedControl.trackGradient).toBeUndefined();
        expect(lightTheme.colors.segmentedControl.activeGradient?.colors).toHaveLength(2);

        expectColorToken(darkTheme.colors.segmentedControl.trackBackground);
        expectColorToken(darkTheme.colors.segmentedControl.activeBackground);
        expect(darkTheme.colors.segmentedControl.trackGradient).toBeUndefined();
        expect(darkTheme.colors.segmentedControl.activeGradient?.colors).toHaveLength(2);
    });

    it('defines primary button gradients separately from color tokens used by non-fill consumers', () => {
        expectColorToken(lightTheme.colors.button.primary.background);
        expect(lightTheme.colors.button.primary.gradient?.colors).toHaveLength(2);
        expectColorToken(darkTheme.colors.button.primary.background);
        expect(darkTheme.colors.button.primary.gradient?.colors).toHaveLength(2);
    });

    it('keeps raised control gradients lighter at the top than the bottom', () => {
        for (const theme of [lightTheme, darkTheme]) {
            expectVerticalGradientToBeLighterAtTop(theme.colors.fab.gradient.colors);
            expectVerticalGradientToBeLighterAtTop(theme.colors.button.primary.gradient.colors);
            expectVerticalGradientToBeLighterAtTop(theme.colors.segmentedControl.activeGradient.colors);
        }
    });

    it('keeps all built-in theme control gradients lighter at the top than the bottom', () => {
        for (const definition of BUILT_IN_THEME_PROFILES) {
            const theme = resolveThemeProfile({ mode: definition.preferredMode, profile: definition.profile });

            expectVerticalGradientToBeLighterAtTop(theme.colors.fab.gradient.colors, `${definition.presetId} fab`);
            expectVerticalGradientToBeLighterAtTop(theme.colors.button.primary.gradient.colors, `${definition.presetId} button.primary`);
            expectVerticalGradientToBeLighterAtTop(theme.colors.segmentedControl.activeGradient.colors, `${definition.presetId} segmentedControl.active`);
        }
    });

    it('keeps wizard scrim aligned for modal and route overlays across light and dark themes', () => {
        expect(rgbaAlpha(lightTheme.colors.overlay.scrimWizard)).toBeLessThan(rgbaAlpha(lightTheme.colors.overlay.scrimStrong));
        expect(rgbaAlpha(darkTheme.colors.overlay.scrimWizard)).toBeLessThan(rgbaAlpha(darkTheme.colors.overlay.scrimStrong));
    });
});
