import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TextInput } from 'react-native-paper';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

import { CodexTopPreviewText } from '../PreviewText';
import { codexTopPreviewHitSize, type CodexTopPreviewPalette } from '../palette';
import { codexTopPreviewMoveDuration, codexTopPreviewMoveEasing } from '../previewMotion';
import { useCodexTopPreviewState } from '../previewStore';
import { useCodexTopPreviewPalette } from '../useCodexTopPreviewPalette';
import {
    CODEX_TOP_PREVIEW_PHASES,
    codexTopPreviewPhaseLabel,
    formatCodexTopPreviewSource,
    listCodexTopPreviewSessions,
    type CodexTopPreviewPhase,
    type CodexTopPreviewSession,
} from '../sampleModel';

/**
 * 打开一条样板对话。只使用路由 id，不读取本机任务。
 */
function openPreviewSession(router: ReturnType<typeof useRouter>, sessionId: string): void {
    router.push({ pathname: '/conversation/[id]', params: { id: sessionId } });
}

/**
 * 三态标签。指示线在减少动态效果时直接跳到当前标签，否则短距离滑过去。
 */
function CodexTopPhaseTabs(props: {
    phase: CodexTopPreviewPhase;
    palette: CodexTopPreviewPalette;
    reducedMotion: boolean;
    onChange: (phase: CodexTopPreviewPhase) => void;
}) {
    const [rowWidth, setRowWidth] = React.useState(0);
    const indicatorX = useSharedValue(0);
    const phaseIndex = CODEX_TOP_PREVIEW_PHASES.indexOf(props.phase);

    React.useEffect(() => {
        const next = rowWidth <= 0 ? 0 : (rowWidth / CODEX_TOP_PREVIEW_PHASES.length) * phaseIndex;
        indicatorX.value = props.reducedMotion
            ? next
            : withTiming(next, { duration: codexTopPreviewMoveDuration(false), easing: codexTopPreviewMoveEasing });
    }, [indicatorX, phaseIndex, props.reducedMotion, rowWidth]);

    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorX.value }],
    }));

    return (
        <View
            accessibilityRole="tablist"
            onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
            style={[styles.tabs, { borderBottomColor: props.palette.line }]}
        >
            {CODEX_TOP_PREVIEW_PHASES.map((phase) => {
                const selected = phase === props.phase;
                return (
                    <Pressable
                        key={phase}
                        accessibilityRole="tab"
                        accessibilityLabel={codexTopPreviewPhaseLabel(phase)}
                        accessibilityState={{ selected }}
                        testID={`codex-top-tab-${phase}`}
                        onPress={() => props.onChange(phase)}
                        style={styles.tab}
                    >
                        <CodexTopPreviewText variant="tab" style={{ color: selected ? props.palette.brandText : props.palette.meta }}>
                            {codexTopPreviewPhaseLabel(phase)}
                        </CodexTopPreviewText>
                    </Pressable>
                );
            })}
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.indicator,
                    indicatorStyle,
                    { width: rowWidth / CODEX_TOP_PREVIEW_PHASES.length, backgroundColor: props.palette.brand },
                ]}
            />
        </View>
    );
}

/**
 * 首页上的两行会话。第一行是标题和时间，第二行是电脑和项目，不放消息预览或状态徽章。
 */
function CodexTopSessionRow(props: {
    session: CodexTopPreviewSession;
    palette: CodexTopPreviewPalette;
    onPress: () => void;
}) {
    const source = formatCodexTopPreviewSource(props.session);
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${props.session.title}，${source}`}
            testID={`codex-top-session-${props.session.id}`}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.row,
                { borderBottomColor: props.palette.line, backgroundColor: pressed ? props.palette.userWash : props.palette.surface },
            ]}
        >
            <View style={styles.rowTitle}>
                <CodexTopPreviewText variant="body" numberOfLines={1} style={[styles.flexText, { color: props.palette.text }]}>
                    {props.session.title}
                </CodexTopPreviewText>
                <CodexTopPreviewText variant="meta" style={{ color: props.palette.meta }}>
                    {props.session.updatedLabel}
                </CodexTopPreviewText>
            </View>
            <CodexTopPreviewText variant="meta" numberOfLines={1} style={{ color: props.palette.meta }}>
                {source}
            </CodexTopPreviewText>
        </Pressable>
    );
}

/**
 * 会话首页：标题、搜索图标、三个分类和两行列表。
 */
export function CodexTopSessionHome() {
    const router = useRouter();
    const state = useCodexTopPreviewState();
    const palette = useCodexTopPreviewPalette();
    const reducedMotion = useReducedMotionPreference();
    const [phase, setPhase] = React.useState<CodexTopPreviewPhase>('running');
    const [searchOpen, setSearchOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const sessions = listCodexTopPreviewSessions(state, phase, searchOpen ? query : '');
    const emptyLabel = query.trim() ? '没有匹配的示例会话' : '没有这类示例会话';

    return (
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
            <View style={styles.header}>
                <CodexTopPreviewText variant="title" style={{ color: palette.text }}>会话</CodexTopPreviewText>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={searchOpen ? '关闭搜索' : '搜索'}
                    accessibilityState={{ expanded: searchOpen }}
                    testID="codex-top-search-toggle"
                    onPress={() => setSearchOpen((open) => !open)}
                    style={styles.iconHit}
                >
                    <Ionicons name={searchOpen ? 'close' : 'search'} size={20} color={palette.text} />
                </Pressable>
            </View>
            {searchOpen ? (
                <TextInput
                    mode="flat"
                    dense
                    value={query}
                    onChangeText={setQuery}
                    placeholder="搜索标题或项目"
                    accessibilityLabel="搜索会话"
                    testID="codex-top-search-input"
                    underlineColor={palette.line}
                    activeUnderlineColor={palette.brand}
                    textColor={palette.text}
                    placeholderTextColor={palette.meta}
                    style={[styles.search, { backgroundColor: palette.surface }]}
                />
            ) : null}
            <CodexTopPhaseTabs phase={phase} palette={palette} reducedMotion={reducedMotion} onChange={setPhase} />
            <ScrollView contentContainerStyle={sessions.length === 0 ? styles.emptyWrap : undefined}>
                {sessions.length === 0 ? (
                    <CodexTopPreviewText variant="meta" style={{ color: palette.meta }}>{emptyLabel}</CodexTopPreviewText>
                ) : sessions.map((session) => (
                    <CodexTopSessionRow
                        key={session.id}
                        session={session}
                        palette={palette}
                        onPress={() => openPreviewSession(router, session.id)}
                    />
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    header: {
        minHeight: codexTopPreviewHitSize,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    iconHit: { width: codexTopPreviewHitSize, height: codexTopPreviewHitSize, alignItems: 'center', justifyContent: 'center' },
    search: { marginHorizontal: 12 },
    tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
    tab: { flex: 1, minHeight: codexTopPreviewHitSize, alignItems: 'center', justifyContent: 'center' },
    indicator: { position: 'absolute', left: 0, bottom: 0, height: 2 },
    row: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
    rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    flexText: { flex: 1 },
    emptyWrap: { padding: 24 },
});
