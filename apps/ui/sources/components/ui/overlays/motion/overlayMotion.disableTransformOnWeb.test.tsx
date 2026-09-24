import { afterEach, describe, expect, it } from 'vitest';
import { Platform } from 'react-native';

import { renderHook } from '@/dev/testkit';

import {
    resolveOverlayExitMs,
    resolveOverlayMotionPreset,
    useOverlayMotionAnimation,
} from './overlayMotion';

const ORIGINAL_PLATFORM = Platform.OS;

afterEach(() => {
    Platform.OS = ORIGINAL_PLATFORM;
});

function styleOf(value: { style: unknown }): { opacity?: unknown; transform?: unknown } {
    return value.style as { opacity?: unknown; transform?: unknown };
}

// `popover`/`bottom` is the selection action bar's motion (slide up from the bottom).
const SLIDE_PRESET = resolveOverlayMotionPreset({ kind: 'popover', direction: 'bottom' });

describe('useOverlayMotionAnimation disableTransformOnWeb', () => {
    it('renders a static, fully-opaque surface (no fade) on web so a child backdrop-filter is never isolated', async () => {
        Platform.OS = 'web';
        const { getCurrent } = await renderHook(() => useOverlayMotionAnimation({
            visible: true,
            preset: SLIDE_PRESET,
            disableTransformOnWeb: true,
        }));
        const style = styleOf(getCurrent());
        // Both a non-`none` transform AND opacity < 1 establish a CSS backdrop root that
        // defeats a descendant glass blur. On web the overlay therefore renders at a
        // static opacity of 1 (no fade); appear/disappear is handled by presence mount.
        expect(style.transform).toBeUndefined();
        expect(style.opacity).toBe(1);
    });

    it('keeps the slide transform on native even when the flag is set (native blur is transform-safe)', async () => {
        Platform.OS = 'ios';
        const { getCurrent } = await renderHook(() => useOverlayMotionAnimation({
            visible: true,
            preset: SLIDE_PRESET,
            disableTransformOnWeb: true,
        }));
        expect(styleOf(getCurrent()).transform).toBeDefined();
    });

    it('keeps the transform on web when the flag is not set', async () => {
        Platform.OS = 'web';
        const { getCurrent } = await renderHook(() => useOverlayMotionAnimation({
            visible: true,
            preset: SLIDE_PRESET,
        }));
        expect(styleOf(getCurrent()).transform).toBeDefined();
    });
});

describe('resolveOverlayExitMs', () => {
    it('collapses the exit to instant on a web glass overlay (no fade to wait for)', () => {
        Platform.OS = 'web';
        expect(resolveOverlayExitMs({
            preset: SLIDE_PRESET,
            reducedMotion: false,
            disableTransformOnWeb: true,
        })).toBe(0);
    });

    it('keeps the preset exit duration on a native glass overlay', () => {
        Platform.OS = 'ios';
        expect(resolveOverlayExitMs({
            preset: SLIDE_PRESET,
            reducedMotion: false,
            disableTransformOnWeb: true,
        })).toBe(SLIDE_PRESET.exitMs);
    });

    it('keeps the preset exit duration on web when the flag is not set', () => {
        Platform.OS = 'web';
        expect(resolveOverlayExitMs({
            preset: SLIDE_PRESET,
            reducedMotion: false,
        })).toBe(SLIDE_PRESET.exitMs);
    });

    it('collapses to instant under reduced motion regardless of platform', () => {
        Platform.OS = 'ios';
        expect(resolveOverlayExitMs({
            preset: SLIDE_PRESET,
            reducedMotion: true,
        })).toBe(0);
    });
});
