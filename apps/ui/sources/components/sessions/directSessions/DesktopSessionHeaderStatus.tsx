import * as React from 'react';
import { Animated, Pressable, View, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { ITEM_TITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { Typography } from '@/constants/Typography';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useLocalSetting } from '@/sync/store/hooks';
import { resolveSessionHeaderActionTargetPx } from '@/components/sessions/actions/sessionHeaderIconMetrics';
import { Modal } from '@/modal';
import { t } from '@/text';
import type { UseDirectSessionRuntimeResult } from '@/components/sessions/model/useDirectSessionRuntime';
import { DesktopApprovalPanel } from './DesktopApprovalPanel';
import { resolveDirectSessionObservationStatus } from './resolveDirectSessionObservationStatus';
import { resolveDirectSessionControlNotice } from './resolveDirectSessionControlNotice';

type DesktopSessionHeaderStatusProps = Readonly<{
    sourceLabel: string;
    status: UseDirectSessionRuntimeResult['status'];
    control: UseDirectSessionRuntimeResult['control'];
    refreshNow: UseDirectSessionRuntimeResult['refreshNow'];
    canWrite: boolean;
    active: boolean;
    notice?: Readonly<{ title: string; body: string }> | null;
}>;

type DesktopSessionDetailsProps = Pick<DesktopSessionHeaderStatusProps, 'sourceLabel' | 'status' | 'control' | 'canWrite' | 'notice'>;

/** 详情只在用户打开时挂载，审批继续使用原请求、权限及控制器的锁定规则。 */
function DesktopSessionDetails(props: DesktopSessionDetailsProps) {
    const observation = resolveDirectSessionObservationStatus(props.status);
    return <View style={styles.details} testID="desktop-session-details">
        {props.sourceLabel ? <Text selectable style={styles.detailText}>{props.sourceLabel}</Text> : null}
        <Text style={styles.detailText}>{t(observation.textKey)}</Text>
        <Text style={styles.hint}>{resolveDirectSessionControlNotice(props.status, true)}</Text>
        {props.notice ? <View testID="desktop-session-details-notice" style={styles.notice}>
            <Text selectable style={styles.detailText}>{props.notice.title}</Text>
            <Text selectable style={styles.hint}>{props.notice.body}</Text>
        </View> : null}
        {props.status?.observation?.state === 'needs_input' && !props.control?.snapshot?.requests.length
            ? <Text style={styles.hint}>桌面正在等待处理，请查看对话中的问题；尚未同步的操作请在电脑上查看。</Text>
            : null}
        {props.control ? <DesktopApprovalPanel control={props.control} canWrite={props.canWrite} /> : null}
    </View>;
}

/** 固定高度只呈现真实观察状态，控制读取异常独立提示，不把运行事实改成未知。 */
export function DesktopSessionHeaderStatus(props: DesktopSessionHeaderStatusProps) {
    const { theme } = useUnistyles();
    const uiFontScale = useLocalSetting('uiFontScale');
    const { fontScale = 1 } = useWindowDimensions();
    // 行与按钮共用实际高度，不依赖会被父框裁掉的 hitSlop；仅字号变化时统一增高。
    const rowHeight = Math.max(resolveSessionHeaderActionTargetPx(), Math.ceil(ITEM_TITLE_TEXT_METRICS.cozy.lineHeight * uiFontScale * fontScale) + 8);
    const reducedMotion = useReducedMotionPreference();
    const opacity = React.useRef(new Animated.Value(1)).current;
    const modalId = React.useRef<string | null>(null);
    const observation = resolveDirectSessionObservationStatus(props.status);
    const observationText = t(observation.textKey);
    const color = theme.colors.status[observation.colorKey];
    const requestCount = props.control?.snapshot?.state === 'running' ? props.control.snapshot.requests.length : 0;
    const hasPending = requestCount > 0 || props.status?.observation?.state === 'needs_input';
    const controlUnavailable = props.control?.error != null || props.status?.machineOnline === false
        || props.status?.externalControl?.canSend !== true;
    const attentionText = hasPending ? (requestCount > 0 ? `待处理 ${requestCount}` : '待处理')
        : props.control?.outcome === 'unknown' ? '待确认'
        : controlUnavailable || props.notice ? '详情' : null;
    const detailsProps = React.useMemo(() => ({
        sourceLabel: props.sourceLabel, status: props.status, control: props.control, canWrite: props.canWrite, notice: props.notice,
    }), [props.sourceLabel, props.status, props.control, props.canWrite, props.notice]);

    /** 只有状态切换才做一次短淡入；不启动持续动画或刷新定时器。 */
    React.useEffect(() => {
        if (reducedMotion || !props.active) {
            opacity.setValue(1);
            return;
        }
        opacity.setValue(0.65);
        const animation = Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true });
        animation.start();
        return () => animation.stop();
    }, [observation.textKey, opacity, props.active, reducedMotion]);

    /** 弹层复用最新控制快照；请求撤回、权限变化和审批锁定不会停留在打开时的旧值。 */
    React.useEffect(() => {
        if (modalId.current) Modal.update(modalId.current, detailsProps);
    }, [detailsProps]);

    /** 离开会话或切到后台页面时关闭当前详情，防止旧会话审批留在新页面上。 */
    React.useEffect(() => {
        if (!props.active && modalId.current) {
            Modal.hide(modalId.current);
            modalId.current = null;
        }
        return () => {
            if (modalId.current) Modal.hide(modalId.current);
            modalId.current = null;
        };
    }, [props.active]);

    /** 查看详情不依赖发送权限，断开连接或只读账号也能核对原请求。 */
    const openDetails = () => {
        if (modalId.current) return;
        const openedId = Modal.show({
            component: DesktopSessionDetails,
            props: detailsProps,
            chrome: { kind: 'card', title: '会话状态', bodyScroll: 'auto' },
            /** 只清理这次打开的弹层，旧关闭回调不能影响后来重新打开的详情。 */
            onRequestClose: () => { if (modalId.current === openedId) modalId.current = null; },
        });
        modalId.current = openedId;
    };

    /** 手动刷新仍调用原有状态和控制 owner，由其处理去重及异步身份校验。 */
    const refresh = () => {
        void props.refreshNow();
        void props.control?.refresh();
    };

    return <View style={[styles.row, { height: rowHeight }]} testID="desktop-session-header-status">
        <Pressable
            testID="desktop-session-header-details"
            accessibilityRole="button"
            accessibilityLabel={`${props.sourceLabel}，${observationText}，查看会话状态`}
            onPress={openDetails}
            style={[styles.summary, { height: rowHeight }]}
        >
            <Animated.View style={[styles.observation, { opacity }]}>
                <View style={[styles.dot, { backgroundColor: color }]} />
                {props.sourceLabel ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.sourceText}>{props.sourceLabel}</Text> : null}
                <Text testID="desktop-session-header-observation" numberOfLines={1} ellipsizeMode="tail" style={styles.summaryText}>
                    {observationText}
                </Text>
            </Animated.View>
        </Pressable>
        {attentionText ? <Pressable
            testID="desktop-session-header-attention"
            accessibilityRole="button"
            accessibilityLabel={hasPending ? `${attentionText}，查看并处理` : '查看连接与操作详情'}
            onPress={openDetails}
            style={[styles.attention, { height: rowHeight }]}
        >
            <Icon name={hasPending ? 'hand' : 'warning-circle'} size={ICON_SIZE.sm} color={theme.colors.status.actionRequired} />
            <Text numberOfLines={1} style={[styles.attentionText, { color: theme.colors.status.actionRequired }]}>{attentionText}</Text>
        </Pressable> : null}
        <Pressable
            testID="desktop-session-header-refresh"
            accessibilityRole="button"
            accessibilityLabel="刷新桌面状态"
            accessibilityState={{ disabled: props.control?.loading === true }}
            disabled={props.control?.loading === true}
            onPress={refresh}
            style={[styles.refresh, { height: rowHeight }]}
        >
            <Icon name="arrow-clockwise" size={ICON_SIZE.md} color={theme.colors.text.secondary} />
        </Pressable>
    </View>;
}

/** 状态长度和错误详情不参与页头高度计算，长电脑名仅在按需详情中完整显示。 */
const styles = StyleSheet.create((theme) => ({
    row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, width: '100%' },
    // 先保留短状态的自然宽度，来源与待处理长文只使用剩余空间。
    summary: { flexGrow: 1, flexShrink: 0, minWidth: 0, justifyContent: 'center' },
    observation: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
    dot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
    sourceText: { ...Typography.default(), ...ITEM_TITLE_TEXT_METRICS.cozy, color: theme.colors.text.secondary, flex: 1, minWidth: 0 },
    summaryText: { ...Typography.default(), ...ITEM_TITLE_TEXT_METRICS.cozy, color: theme.colors.text.secondary, flexShrink: 0 },
    attention: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 48, maxWidth: '40%', flexShrink: 1, paddingHorizontal: 8, gap: 4 },
    attentionText: { ...Typography.default('semiBold'), ...ITEM_TITLE_TEXT_METRICS.cozy, flexShrink: 1 },
    refresh: { width: 48, alignItems: 'center', justifyContent: 'center' },
    details: { gap: 12, padding: 16 },
    notice: { gap: 4 },
    detailText: { ...Typography.default(), ...ITEM_TITLE_TEXT_METRICS.cozy, color: theme.colors.text.primary },
    hint: { ...Typography.default(), ...ITEM_TITLE_TEXT_METRICS.cozy, color: theme.colors.text.secondary },
}));
