import React from 'react';
import { Image, Platform, View } from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';

import { addBreadcrumbIfEnabled } from '@/utils/system/sentry';
import { createNativeThemePreferenceTransitionController } from './nativeThemePreferenceTransitionController';
import { registerNativeThemePreferenceTransitionController } from './themePreferenceTransition';
import {
    THEME_TRANSITION_DURATION_MS,
    THEME_TRANSITION_EASING_BEZIER,
} from './themePreferenceTransitionMotion';

function waitForFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    });
}

function recordNativeThemeTransitionBreadcrumb(data: Readonly<{ phase: string }>): void {
    addBreadcrumbIfEnabled({
        category: 'theme.nativeTransition',
        level: 'info',
        data,
    });
}

export function ThemePreferenceTransitionHost(props: Readonly<{ children: React.ReactNode }>) {
    const surfaceRef = React.useRef<View>(null);
    const [overlayUri, setOverlayUri] = React.useState<string | null>(null);
    const [surfaceHeight, setSurfaceHeight] = React.useState(0);
    const revealProgress = useSharedValue(0);

    const overlayClipStyle = useAnimatedStyle(() => ({
        height: Math.max(0, surfaceHeight * (1 - revealProgress.value)),
    }));

    const captureSurface = React.useCallback(async () => {
        if (Platform.OS === 'web') return null;
        if (!surfaceRef.current) return null;
        try {
            return await captureRef(surfaceRef, {
                format: 'png',
                quality: 1,
                result: 'tmpfile',
            });
        } catch {
            return null;
        }
    }, []);

    const animateOverlay = React.useCallback(() => {
        return new Promise<void>((resolve) => {
            revealProgress.value = withTiming(
                1,
                {
                    duration: THEME_TRANSITION_DURATION_MS,
                    easing: Easing.bezier(...THEME_TRANSITION_EASING_BEZIER),
                },
                () => {
                    runOnJS(resolve)();
                },
            );
        });
    }, [revealProgress]);

    React.useEffect(() => {
        if (Platform.OS === 'web') return;
        return registerNativeThemePreferenceTransitionController(
            createNativeThemePreferenceTransitionController({
                animateOverlay,
                captureSurface,
                hideOverlay: () => {
                    setOverlayUri(null);
                    revealProgress.value = 0;
                },
                showOverlay: (uri) => {
                    revealProgress.value = 0;
                    setOverlayUri(uri);
                },
                recordBreadcrumb: recordNativeThemeTransitionBreadcrumb,
                waitForFrame,
            }),
        );
    }, [animateOverlay, captureSurface, revealProgress]);

    return (
        <View
            ref={surfaceRef}
            collapsable={false}
            onLayout={(event) => setSurfaceHeight(event.nativeEvent.layout.height)}
            style={{ flex: 1 }}
        >
            {props.children}
            {overlayUri ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        StyleSheetAbsoluteFillObject,
                        styles.overlayClip,
                        overlayClipStyle,
                    ]}
                >
                    <Image
                        source={{ uri: overlayUri }}
                        style={StyleSheetAbsoluteFillObject}
                        resizeMode="stretch"
                    />
                </Animated.View>
            ) : null}
        </View>
    );
}

const StyleSheetAbsoluteFillObject = {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
};

const styles = {
    overlayClip: {
        overflow: 'hidden' as const,
        zIndex: 10000,
    },
};
