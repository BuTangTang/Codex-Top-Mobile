import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { CodexTopPreviewText } from '../PreviewText';
import { codexTopPreviewHitSize } from '../palette';
import { useCodexTopPreviewActions, useCodexTopPreviewState } from '../previewStore';
import { useCodexTopPreviewPalette } from '../useCodexTopPreviewPalette';
import { type CodexTopPreviewAppearance } from '../sampleModel';

const APPEARANCE_OPTIONS: readonly { value: CodexTopPreviewAppearance; label: string }[] = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
];

/**
 * 我的页面。账号、通知、外观、连接和关于都只作用于本页示例，不登录、不切换语言。
 */
export function CodexTopMePane() {
    const state = useCodexTopPreviewState();
    const actions = useCodexTopPreviewActions();
    const palette = useCodexTopPreviewPalette();
    return (
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
            <View style={styles.header}>
                <CodexTopPreviewText variant="title" style={{ color: palette.text }}>我的</CodexTopPreviewText>
            </View>
            <View accessibilityLabel="示例账号，仅本页预览，不会登录" style={styles.account}>
                <CodexTopPreviewText variant="body" style={{ color: palette.text }}>示例账号</CodexTopPreviewText>
                <CodexTopPreviewText variant="meta" style={{ color: palette.meta }}>仅本页预览，不会登录</CodexTopPreviewText>
            </View>
            <View style={[styles.row, { borderTopColor: palette.line }]}>
                <View style={styles.rowText}>
                    <CodexTopPreviewText variant="body" style={{ color: palette.text }}>通知</CodexTopPreviewText>
                    <CodexTopPreviewText variant="meta" style={{ color: palette.meta }}>只记住本页示例</CodexTopPreviewText>
                </View>
                <Switch
                    accessibilityLabel="通知"
                    testID="codex-top-notifications"
                    value={state.notificationsEnabled}
                    onValueChange={actions.setNotifications}
                    trackColor={{ true: palette.brand, false: palette.line }}
                />
            </View>
            <View style={styles.appearanceBlock}>
                <CodexTopPreviewText variant="body" style={{ color: palette.text }}>外观</CodexTopPreviewText>
                <View style={styles.appearanceRow}>
                    {APPEARANCE_OPTIONS.map((option) => {
                        const selected = state.appearance === option.value;
                        return (
                            <Pressable
                                key={option.value}
                                accessibilityRole="button"
                                accessibilityLabel={option.label}
                                accessibilityState={{ selected }}
                                testID={`codex-top-appearance-${option.value}`}
                                onPress={() => actions.setAppearance(option.value)}
                                style={styles.appearanceHit}
                            >
                                <CodexTopPreviewText variant="meta" style={{ color: selected ? palette.brandText : palette.meta }}>
                                    {option.label}
                                </CodexTopPreviewText>
                            </Pressable>
                        );
                    })}
                </View>
            </View>
            <View accessibilityLabel="连接，未连接真实服务" testID="codex-top-connection" style={[styles.row, { borderTopColor: palette.line }]}>
                <View style={styles.rowText}>
                    <CodexTopPreviewText variant="body" style={{ color: palette.text }}>连接</CodexTopPreviewText>
                    <CodexTopPreviewText variant="meta" style={{ color: palette.meta }}>未连接真实服务</CodexTopPreviewText>
                </View>
            </View>
            <View accessibilityLabel="关于，Codex Top 界面预览，使用合成数据" testID="codex-top-about" style={styles.about}>
                <CodexTopPreviewText variant="body" style={{ color: palette.text }}>关于</CodexTopPreviewText>
                <CodexTopPreviewText variant="meta" style={{ color: palette.meta }}>Codex Top 界面预览，使用合成数据。</CodexTopPreviewText>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    header: { minHeight: 48, paddingHorizontal: 16, justifyContent: 'center' },
    account: { paddingHorizontal: 16, paddingBottom: 12, gap: 2 },
    row: { minHeight: codexTopPreviewHitSize, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
    rowText: { flex: 1, gap: 2 },
    appearanceBlock: { paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
    appearanceRow: { flexDirection: 'row' },
    appearanceHit: { minHeight: codexTopPreviewHitSize, minWidth: codexTopPreviewHitSize, justifyContent: 'center', paddingRight: 16 },
    about: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
});
