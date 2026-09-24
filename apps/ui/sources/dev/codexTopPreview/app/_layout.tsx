import * as React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

import { CodexTopPreviewText } from '../PreviewText';
import { buildCodexTopPreviewPaperTheme } from '../paperTheme';
import { codexTopPreviewMoveDuration } from '../previewMotion';
import { CodexTopPreviewStateProvider } from '../previewStore';
import { useCodexTopPreviewPalette } from '../useCodexTopPreviewPalette';

/**
 * 预览外壳。挂上安全区、手势、键盘和 Paper，不接入正式登录、实时连接或同步。
 */
function CodexTopPreviewShell() {
    const palette = useCodexTopPreviewPalette();
    const insets = useSafeAreaInsets();
    const reducedMotion = useReducedMotionPreference();
    const paperTheme = React.useMemo(() => buildCodexTopPreviewPaperTheme(palette), [palette]);
    return (
        <PaperProvider theme={paperTheme}>
            <StatusBar barStyle={palette.scheme === 'dark' ? 'light-content' : 'dark-content'} />
            <View style={[styles.frame, { backgroundColor: palette.background, paddingTop: insets.top }]}>
                <CodexTopPreviewText
                    variant="meta"
                    accessibilityRole="text"
                    testID="codex-top-preview-banner"
                    style={[styles.banner, { color: palette.meta }]}
                >
                    界面预览 · 示例数据
                </CodexTopPreviewText>
                <Stack
                    screenOptions={{
                        headerShown: false,
                        animation: reducedMotion ? 'fade' : 'slide_from_right',
                        animationDuration: codexTopPreviewMoveDuration(reducedMotion),
                        contentStyle: { backgroundColor: palette.background },
                    }}
                >
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="conversation/[id]" />
                </Stack>
            </View>
        </PaperProvider>
    );
}

/**
 * 样板路由根。只包必要的容器，默认正式入口不会加载这个文件。
 */
export default function CodexTopPreviewRootLayout() {
    return (
        <GestureHandlerRootView style={styles.frame}>
            <SafeAreaProvider initialMetrics={initialWindowMetrics}>
                <KeyboardProvider>
                    <CodexTopPreviewStateProvider>
                        <CodexTopPreviewShell />
                    </CodexTopPreviewStateProvider>
                </KeyboardProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    frame: { flex: 1 },
    banner: { paddingHorizontal: 16, paddingBottom: 2 },
});
