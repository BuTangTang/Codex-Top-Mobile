import * as React from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { createBackdropWebStyle } from '@/components/ui/overlays/createBackdropLayerStyle';
import { useReduceTransparency } from '@/hooks/ui/useReduceTransparency';

import { getBlurViewComponent } from './blurMaterial';
import { getGlassViewComponent, useLiquidGlassAvailable } from './liquidGlass';
import { resolveGlassCapability } from './resolveGlassCapability';

export type GlassSurfaceProps = Readonly<{
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    /**
     * Liquid Glass effect style. `regular` is the default chrome material; `clear`
     * is more transparent. Ignored when falling back to blur/solid.
     */
    glassEffectStyle?: 'regular' | 'clear';
    /** Blur intensity used by the `expo-blur` fallback. */
    blurIntensity?: number;
    /** When false, renders an opaque solid surface instead of glass/blur. */
    enabled?: boolean;
    /** Fill color for the opaque solid tier (Android / reduce-transparency / disabled). Defaults to `surface.base`. */
    solidColor?: string;
    testID?: string;
}>;

/**
 * 按平台能力选择底栏等共用玻璃表面的材质，保留内容和交互。
 *
 * - iOS 26 with Liquid Glass → real `GlassView` (`expo-glass-effect`).
 * - Older iOS builds           → translucent `expo-blur` `BlurView`.
 * - Web                       → CSS backdrop blur.
 * - Android / Reduce Transparency → opaque `surface.base`.
 *
 * Callers pass layout style (padding, border) only; the background/material is
 * owned here so each tier renders correctly. Do not pass an opaque
 * `backgroundColor` in `style` or the translucency tiers will be hidden.
 */
export const GlassSurface = React.memo(function GlassSurface(props: GlassSurfaceProps) {
    const { theme } = useUnistyles();
    const liquidGlassAvailable = useLiquidGlassAvailable();
    const reduceTransparency = useReduceTransparency();

    const capability = props.enabled === false
        ? 'solid'
        : resolveGlassCapability({
            liquidGlassAvailable,
            // SDK 54 的 Android blur 仍为实验能力；全局底栏捕获导航栈时，
            // 实测转场后正文会白屏或持续发白，关闭 blur 才恢复，故复用实色材质。
            blurAvailable: Platform.OS === 'ios',
            webBlurAvailable: Platform.OS === 'web',
            reduceTransparency,
        });

    if (capability === 'liquidGlass') {
        const GlassView = getGlassViewComponent();
        if (GlassView) {
            return (
                <GlassView
                    testID={props.testID}
                    glassEffectStyle={props.glassEffectStyle ?? 'regular'}
                    style={props.style}
                >
                    {props.children}
                </GlassView>
            );
        }
    }

    if (capability === 'blur') {
        const BlurView = getBlurViewComponent();
        if (BlurView) {
            return (
                <BlurView
                    testID={props.testID}
                    tint={theme.dark ? 'dark' : 'light'}
                    intensity={props.blurIntensity ?? 50}
                    style={props.style}
                >
                    {props.children}
                </BlurView>
            );
        }
    }

    if (capability === 'webBlur') {
        return (
            <View
                testID={props.testID}
                // `createBackdropWebStyle` returns web `CSSProperties` (backdrop-filter +
                // -webkit- prefix + tint, with a "blur off" preference fallback); cast to
                // the RN-web `ViewStyle` at this web boundary.
                style={[
                    createBackdropWebStyle({
                        backgroundColor: theme.colors.glass.webBlurTint,
                        // Map the native blur intensity (≈25/50/80) to a softer CSS radius
                        // so web glass reads as a refined frost, not an overpowering blur.
                        blurPx: Math.round((props.blurIntensity ?? 50) / 5),
                        fallbackBackgroundColorWhenBlurDisabled: props.solidColor ?? theme.colors.surface.base,
                    }) as unknown as ViewStyle,
                    props.style,
                ]}
            >
                {props.children}
            </View>
        );
    }

    return (
        <View
            testID={props.testID}
            style={[{ backgroundColor: props.solidColor ?? theme.colors.surface.base }, props.style]}
        >
            {props.children}
        </View>
    );
});
