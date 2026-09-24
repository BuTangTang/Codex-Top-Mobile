import * as React from 'react';
import { Pressable, Text } from 'react-native';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const nativeBoundary = vi.hoisted(() => ({
    platform: 'android' as 'android' | 'ios' | 'web',
    liquidGlassAvailable: false,
    getBlurViewComponent: vi.fn(() => 'NativeBlurView'),
}));

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'android' }, {
        Platform: { get OS() { return nativeBoundary.platform; } },
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

// 只替代原生材质边界，保留 GlassSurface 的平台选择与无障碍逻辑。
vi.mock('./blurMaterial', () => ({ getBlurViewComponent: nativeBoundary.getBlurViewComponent }));
vi.mock('./liquidGlass', () => ({
    useLiquidGlassAvailable: () => nativeBoundary.liquidGlassAvailable,
    getGlassViewComponent: () => 'NativeGlassView',
}));

import { GlassSurface } from './GlassSurface';

/** 用可操作的子内容验证材质切换不会让 Android 控件丢失状态。 */
function SurfaceContent() {
    const [count, setCount] = React.useState(0);
    return (
        <Pressable testID="surface-action" onPress={() => setCount((value) => value + 1)}>
            <Text>{count}</Text>
        </Pressable>
    );
}

describe('GlassSurface platform compatibility', () => {
    beforeEach(() => {
        nativeBoundary.platform = 'android';
        nativeBoundary.liquidGlassAvailable = false;
        nativeBoundary.getBlurViewComponent.mockClear();
    });

    it('keeps Android content usable without native blur across preference changes', async () => {
        const screen = await renderScreen(<GlassSurface enabled><SurfaceContent /></GlassSurface>);

        expect(screen.findAllByType('NativeBlurView')).toHaveLength(0);
        expect(nativeBoundary.getBlurViewComponent).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('surface-action');
        expect(screen.getTextContent()).toBe('1');

        for (const enabled of [false, true]) {
            await act(async () => {
                screen.tree.update(<GlassSurface enabled={enabled}><SurfaceContent /></GlassSurface>);
            });
            expect(screen.findAllByType('NativeBlurView')).toHaveLength(0);
            expect(screen.getTextContent()).toBe('1');
        }
        await screen.pressByTestIdAsync('surface-action');
        expect(screen.getTextContent()).toBe('2');
    });

    it('preserves the iOS native blur fallback and requested intensity', async () => {
        nativeBoundary.platform = 'ios';
        const screen = await renderScreen(
            <GlassSurface blurIntensity={80}><SurfaceContent /></GlassSurface>,
        );

        expect(screen.findByType('NativeBlurView').props.intensity).toBe(80);
        await screen.pressByTestIdAsync('surface-action');
        expect(screen.getTextContent()).toBe('1');
    });

    it('preserves Liquid Glass when the iOS native capability is available', async () => {
        nativeBoundary.platform = 'ios';
        nativeBoundary.liquidGlassAvailable = true;
        const screen = await renderScreen(
            <GlassSurface glassEffectStyle="clear"><SurfaceContent /></GlassSurface>,
        );

        expect(screen.findByType('NativeGlassView').props.glassEffectStyle).toBe('clear');
        expect(nativeBoundary.getBlurViewComponent).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('surface-action');
        expect(screen.getTextContent()).toBe('1');
    });

    it('preserves CSS blur on web without loading a native material', async () => {
        nativeBoundary.platform = 'web';
        const screen = await renderScreen(
            <GlassSurface testID="surface" blurIntensity={50}><SurfaceContent /></GlassSurface>,
        );

        const style = Object.assign({}, ...screen.findHostByTestId('surface')!.props.style);
        expect(style.backdropFilter).toBe('blur(10px)');
        expect(nativeBoundary.getBlurViewComponent).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('surface-action');
        expect(screen.getTextContent()).toBe('1');
    });
});
