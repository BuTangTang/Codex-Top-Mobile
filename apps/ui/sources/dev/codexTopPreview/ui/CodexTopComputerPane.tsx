import { StyleSheet, View } from 'react-native';

import { CodexTopPreviewText } from '../PreviewText';
import { useCodexTopPreviewState } from '../previewStore';
import { useCodexTopPreviewPalette } from '../useCodexTopPreviewPalette';

/**
 * 电脑页只展示一台标明为示例的电脑，不汇总多台电脑。
 */
export function CodexTopComputerPane() {
    const { computer } = useCodexTopPreviewState();
    const palette = useCodexTopPreviewPalette();
    return (
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
            <View style={styles.header}>
                <CodexTopPreviewText variant="title" style={{ color: palette.text }}>电脑</CodexTopPreviewText>
            </View>
            <View
                accessibilityLabel={`${computer.name}，示例数据，项目 ${computer.projectName}`}
                testID="codex-top-computer-example"
                style={[styles.block, { backgroundColor: palette.surface, borderColor: palette.line }]}
            >
                <CodexTopPreviewText variant="body" style={{ color: palette.text }}>{computer.name}</CodexTopPreviewText>
                <CodexTopPreviewText variant="meta" style={{ color: palette.meta }}>示例数据 · 未连接真实电脑</CodexTopPreviewText>
                <CodexTopPreviewText variant="meta" style={{ color: palette.meta }}>项目 {computer.projectName}</CodexTopPreviewText>
            </View>
            <CodexTopPreviewText variant="meta" style={[styles.note, { color: palette.meta }]}>
                这里只放这一台合成电脑，用来辨认会话来源。
            </CodexTopPreviewText>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    header: { minHeight: 48, paddingHorizontal: 16, justifyContent: 'center' },
    block: { marginHorizontal: 16, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
    note: { paddingHorizontal: 16, paddingTop: 12 },
});
