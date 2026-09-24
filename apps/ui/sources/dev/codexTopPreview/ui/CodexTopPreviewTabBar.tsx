import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CodexTopPreviewText } from '../PreviewText';
import { codexTopPreviewHitSize } from '../palette';
import { useCodexTopPreviewPalette } from '../useCodexTopPreviewPalette';

const TABS = [
    { name: 'index', label: '会话', icon: 'chatbubble-ellipses-outline', testID: 'codex-top-tab-sessions' },
    { name: 'computer', label: '电脑', icon: 'desktop-outline', testID: 'codex-top-tab-computer' },
    { name: 'me', label: '我的', icon: 'person-outline', testID: 'codex-top-tab-me' },
] as const;

/**
 * 底部三个入口。只负责切换样板页，不读取正式导航状态。
 */
export function CodexTopPreviewTabBar(props: {
    index: number;
    routes: readonly { name: string }[];
    onNavigate: (name: string) => void;
}) {
    const palette = useCodexTopPreviewPalette();
    const insets = useSafeAreaInsets();
    return (
        <View style={[styles.bar, { paddingBottom: insets.bottom, backgroundColor: palette.surface, borderTopColor: palette.line }]}>
            {TABS.map((tab) => {
                const routeIndex = props.routes.findIndex((route) => route.name === tab.name);
                const selected = routeIndex === props.index;
                return (
                    <Pressable
                        key={tab.name}
                        accessibilityRole="tab"
                        accessibilityLabel={tab.label}
                        accessibilityState={{ selected }}
                        testID={tab.testID}
                        onPress={() => props.onNavigate(tab.name)}
                        style={styles.hit}
                    >
                        <Ionicons name={tab.icon} size={20} color={selected ? palette.brandText : palette.meta} />
                        <CodexTopPreviewText variant="tab" style={{ color: selected ? palette.brandText : palette.meta }}>
                            {tab.label}
                        </CodexTopPreviewText>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
    hit: { flex: 1, minHeight: codexTopPreviewHitSize, alignItems: 'center', justifyContent: 'center', gap: 2 },
});
