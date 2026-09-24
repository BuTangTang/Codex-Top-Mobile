import * as React from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, TextInput } from 'react-native-paper';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

import { CodexTopPreviewText } from '../PreviewText';
import { codexTopPreviewHitSize } from '../palette';
import { codexTopPreviewFadeDuration } from '../previewMotion';
import { useCodexTopPreviewActions, useCodexTopPreviewState } from '../previewStore';
import { useCodexTopPreviewPalette } from '../useCodexTopPreviewPalette';
import {
    formatCodexTopPreviewSource,
    sessionHasPendingApproval,
    type CodexTopPreviewMessage,
} from '../sampleModel';

/**
 * 渲染一条样板消息。只有本次新出现的消息才淡入，已有消息保持静止。
 */
function CodexTopMessage(props: {
    message: CodexTopPreviewMessage;
    fresh: boolean;
    reducedMotion: boolean;
    textColor: string;
    metaColor: string;
    wash: string;
}) {
    const roleLabel = props.message.role === 'user' ? '我' : (props.message.approvalPending ? '待确认' : '回复');
    const entering = props.fresh && !props.reducedMotion
        ? FadeIn.duration(codexTopPreviewFadeDuration(false))
        : undefined;
    return (
        <Animated.View
            entering={entering}
            accessibilityLabel={`${roleLabel}，${props.message.text}`}
            style={[
                styles.message,
                props.message.role === 'user' ? { backgroundColor: props.wash, alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
            ]}
        >
            <CodexTopPreviewText variant="meta" style={{ color: props.metaColor }}>{roleLabel}</CodexTopPreviewText>
            <CodexTopPreviewText variant="body" selectable style={{ color: props.textColor }}>{props.message.text}</CodexTopPreviewText>
        </Animated.View>
    );
}

/**
 * 样板对话。发送和审批只改本地合成状态。
 */
export function CodexTopConversationPane(props: { sessionId: string; onBack: () => void }) {
    const state = useCodexTopPreviewState();
    const actions = useCodexTopPreviewActions();
    const palette = useCodexTopPreviewPalette();
    const reducedMotion = useReducedMotionPreference();
    const insets = useSafeAreaInsets();
    const session = state.sessions.find((item) => item.id === props.sessionId);
    const [draft, setDraft] = React.useState('');
    const [keyboardOpen, setKeyboardOpen] = React.useState(false);
    const scrollRef = React.useRef<ScrollView>(null);
    const [initialIds] = React.useState(() => new Set(session?.messages.map((message) => message.id) ?? []));

    React.useEffect(() => {
        const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
        const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

    React.useEffect(() => {
        scrollRef.current?.scrollToEnd({ animated: !reducedMotion });
    }, [reducedMotion, session?.messages.length]);

    /**
     * 发送当前输入。空白不写入，发送后收起键盘。
     */
    function sendDraft(): void {
        if (!session) return;
        const text = draft.trim();
        if (!text) return;
        actions.sendMessage(session.id, text);
        setDraft('');
        Keyboard.dismiss();
    }

    if (!session) {
        return (
            <View style={[styles.screen, { backgroundColor: palette.background }]}>
                <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={props.onBack} style={styles.iconHit}>
                    <Ionicons name="chevron-back" size={22} color={palette.text} />
                </Pressable>
                <CodexTopPreviewText variant="body" style={{ color: palette.meta, padding: 16 }}>没有这条示例会话</CodexTopPreviewText>
            </View>
        );
    }

    const waiting = sessionHasPendingApproval(session);
    const bottomInset = keyboardOpen ? 8 : Math.max(insets.bottom, 8);

    return (
        <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: palette.background }]}>
            <View style={[styles.header, { borderBottomColor: palette.line }]}>
                <Pressable accessibilityRole="button" accessibilityLabel="返回" testID="codex-top-back" onPress={props.onBack} style={styles.iconHit}>
                    <Ionicons name="chevron-back" size={22} color={palette.text} />
                </Pressable>
                <View style={styles.headerText}>
                    <CodexTopPreviewText variant="body" numberOfLines={1} style={{ color: palette.text }}>{session.title}</CodexTopPreviewText>
                    <CodexTopPreviewText variant="meta" numberOfLines={1} style={{ color: palette.meta }}>
                        {formatCodexTopPreviewSource(session)}
                    </CodexTopPreviewText>
                </View>
            </View>
            <ScrollView ref={scrollRef} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled">
                {session.messages.map((message) => (
                    <CodexTopMessage
                        key={message.id}
                        message={message}
                        fresh={!initialIds.has(message.id)}
                        reducedMotion={reducedMotion}
                        textColor={palette.text}
                        metaColor={palette.meta}
                        wash={palette.userWash}
                    />
                ))}
            </ScrollView>
            {waiting ? (
                <View style={styles.approvalRow}>
                    <Button
                        mode="contained"
                        compact
                        accessibilityLabel="确认"
                        testID="codex-top-approve"
                        onPress={() => actions.resolveApproval(session.id, 'confirm')}
                        style={styles.actionButton}
                    >
                        确认
                    </Button>
                    <Button
                        mode="outlined"
                        compact
                        accessibilityLabel="拒绝"
                        testID="codex-top-reject"
                        onPress={() => actions.resolveApproval(session.id, 'reject')}
                        style={styles.actionButton}
                        textColor={palette.brandText}
                    >
                        拒绝
                    </Button>
                </View>
            ) : null}
            <View style={[styles.composer, { borderTopColor: palette.line, paddingBottom: bottomInset, backgroundColor: palette.surface }]}>
                <TextInput
                    mode="flat"
                    dense
                    multiline
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="给示例任务写一句"
                    accessibilityLabel="消息输入"
                    testID="codex-top-message-input"
                    underlineColor="transparent"
                    activeUnderlineColor="transparent"
                    textColor={palette.text}
                    placeholderTextColor={palette.meta}
                    style={[styles.input, { backgroundColor: palette.background }]}
                />
                <Button
                    mode="contained"
                    compact
                    disabled={draft.trim().length === 0}
                    accessibilityLabel="发送"
                    testID="codex-top-send"
                    onPress={sendDraft}
                    style={styles.send}
                >
                    发送
                </Button>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
    headerText: { flex: 1, paddingRight: 16 },
    iconHit: { width: codexTopPreviewHitSize, height: codexTopPreviewHitSize, alignItems: 'center', justifyContent: 'center' },
    messages: { padding: 16, gap: 12 },
    message: { maxWidth: '88%', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
    approvalRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
    actionButton: { flex: 1, minHeight: codexTopPreviewHitSize, justifyContent: 'center' },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
    input: { flex: 1, maxHeight: 120 },
    send: { minHeight: codexTopPreviewHitSize, justifyContent: 'center' },
});
