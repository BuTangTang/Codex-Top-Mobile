import * as React from 'react';
import { FlatList, Pressable, View, StyleSheet as NativeStyleSheet, type ListRenderItemInfo, type NativeSyntheticEvent, type NativeScrollEvent, type ViewToken } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { ITEM_TITLE_TEXT_METRICS, ITEM_SUBTITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { MOTION_STANDARD_BEZIER, motionTokens } from '@/components/ui/motion/motionTokens';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text, TextInput } from '@/components/ui/text/Text';
import { useResolvedItemDensity } from '@/components/ui/lists/useResolvedItemDensity';
import type { Theme } from '@/theme';
import { t } from '@/text';

import {
    buildDirectBrowseCandidateDisplayTitle,
    buildDirectBrowseCandidateRightElement,
    buildDirectBrowseCandidateSubtitle,
} from './buildDirectBrowseCandidatePresentation';
import type { DirectBrowseCandidate } from './useDirectBrowseCandidates';
import { DirectBrowseCandidateActions } from './DirectBrowseCandidateActions';
import { formatRelativeTimeShort } from '@/components/ui/selectionList/formatRelativeTimeShort';
import type { PhoneBrowseRow } from './phoneBrowseAggregation';
import { useSessionCockpitBottomChromeHeight } from '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry';

type AppTheme = Theme;

/** 桌面沿用既有列表，手机以主题语义色和可缩放字号呈现平面两行。 */
const stylesheet = StyleSheet.create((theme: AppTheme) => ({
    helperText: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        color: theme.colors.text.secondary,
        fontSize: 13,
    },
    searchContainer: {
        position: 'relative',
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 6,
    },
    searchInput: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.surface.inset,
        color: theme.colors.text.primary,
        fontSize: 13,
    },
    searchInputWithAugmentingIndicator: {
        paddingRight: 40,
    },
    searchAugmentingIndicator: {
        position: 'absolute',
        right: 22,
        top: 22,
    },
    loadingRow: {
        paddingVertical: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    candidateAccessory: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    phoneList: { flex: 1, backgroundColor: theme.colors.surface.base },
    phoneRow: { minHeight: 80, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: NativeStyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.default },
    phoneRowBody: { flex: 1, gap: 6 },
    phoneStatusSlot: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
    phoneRunningArc: { width: 18, height: 18, borderWidth: 2, borderRadius: 9, borderLeftColor: theme.colors.accent.blue, borderRightColor: theme.colors.accent.blue, borderTopColor: 'transparent', borderBottomColor: 'transparent' },
    phoneRowPressed: { backgroundColor: theme.colors.surface.inset },
    phoneTitleLine: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
    phoneTitle: { flex: 1, ...ITEM_TITLE_TEXT_METRICS.comfortable, color: theme.colors.text.primary },
    phoneMeta: { ...ITEM_SUBTITLE_TEXT_METRICS.cozy, color: theme.colors.text.secondary },
    phoneSource: { flex: 1, ...ITEM_SUBTITLE_TEXT_METRICS.cozy, color: theme.colors.text.secondary },
    phoneFooter: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    phoneAction: { fontSize: 13, color: theme.colors.accent.blue },
}));

/** 保持已有行可见，失效续页在原按钮位置提供刷新入口，避免用户返回列表顶部。 */
export const DirectBrowseCandidatesList = React.memo(function DirectBrowseCandidatesList(props: Readonly<{
    compact?: boolean;
    hideSearch?: boolean;
    candidates: readonly DirectBrowseCandidate[];
    loading: boolean;
    error: string | null;
    nextCursor: string | null;
    loadingMore: boolean;
    searchAugmenting: boolean;
    searchIncomplete: boolean;
    refreshRequired: boolean;
    onRefresh: () => void;
    linkingSessionId: string | null;
    deletingSessionId: string | null;
    canDeleteCandidates: boolean;
    providerLabel: string;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    onSelectCandidate: (candidate: DirectBrowseCandidate) => void;
    onDeleteCandidate: (candidate: DirectBrowseCandidate) => void;
    onLoadMore: () => void;
}>) {
    const { theme } = useUnistyles() as { theme: AppTheme };
    const styles = stylesheet;
    const itemDensity = useResolvedItemDensity(undefined);
    const hasSearchQuery = props.searchQuery.trim().length > 0;

    return (
        <ItemGroup title={props.compact ? undefined : t('directSessions.browseCandidates')}>
            {!props.hideSearch ? <View style={styles.searchContainer}>
                <TextInput
                    testID="direct-session-candidates-search-input"
                    value={props.searchQuery}
                    onChangeText={props.onSearchQueryChange}
                    placeholder={t('directSessions.browseSearchPlaceholder')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    style={[styles.searchInput, props.searchAugmenting ? styles.searchInputWithAugmentingIndicator : null]}
                />
                {props.searchAugmenting ? (
                    <View testID="direct-session-candidates-search-augmenting" style={styles.searchAugmentingIndicator}>
                        <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                    </View>
                ) : null}
            </View> : null}

            {!props.loading && props.searchIncomplete && !props.searchAugmenting ? (
                <Text
                    testID="direct-session-candidates-search-incomplete"
                    accessibilityLiveRegion="polite"
                    style={styles.helperText}
                >
                    {t(hasSearchQuery ? 'directSessions.browseSearchIncomplete' : 'directSessions.browseListIncomplete')}
                </Text>
            ) : null}

            {props.refreshRequired ? (
                <Text testID="direct-session-candidates-list-changed" accessibilityLiveRegion="polite" style={styles.helperText}>
                    {t('directSessions.browseListChanged')}
                </Text>
            ) : null}
            {props.error ? <Text testID="direct-session-candidates-error" style={styles.helperText}>{props.error}</Text> : null}
            {props.refreshRequired || props.error || (props.searchIncomplete && !props.searchAugmenting) ? (
                <Item testID="direct-session-candidates-refresh" title={t('common.refresh')}
                    onPress={props.onRefresh} loading={props.loading} disabled={props.loading} />
            ) : null}

            {props.loading && props.candidates.length === 0 ? (
                <View style={styles.loadingRow}>
                    <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                </View>
            ) : props.candidates.length === 0 && (props.error || props.refreshRequired || props.searchIncomplete) ? null : props.candidates.length === 0 && hasSearchQuery ? (
                props.searchIncomplete ? null : <View>
                    <Text style={styles.helperText}>{t('directSessions.browseNoSearchResults')}</Text>
                </View>
            ) : props.candidates.length === 0 ? (
                <View>
                    <Text style={styles.helperText}>{t('directSessions.browseNoCandidates')}</Text>
                </View>
            ) : (
                <>
                    {props.candidates.map((candidate) => (
                        <Item
                            density={props.compact ? "cozy" : undefined}
                            titleLines={props.compact ? 2 : undefined}
                            key={candidate.remoteSessionId}
                            testID={`direct-session-candidate:${candidate.remoteSessionId}`}
                            title={buildDirectBrowseCandidateDisplayTitle(candidate)}
                            subtitle={buildDirectBrowseCandidateSubtitle(candidate, theme, itemDensity)}
                            rightElement={props.canDeleteCandidates ? (
                                <View style={styles.candidateAccessory}>
                                    {buildDirectBrowseCandidateRightElement(candidate, theme, itemDensity)}
                                    <DirectBrowseCandidateActions
                                        candidateTitle={buildDirectBrowseCandidateDisplayTitle(candidate)}
                                        candidateId={candidate.remoteSessionId}
                                        providerLabel={props.providerLabel}
                                        deleting={props.deletingSessionId !== null}
                                        onDelete={() => props.onDeleteCandidate(candidate)}
                                    />
                                </View>
                            ) : buildDirectBrowseCandidateRightElement(candidate, theme, itemDensity)}
                            rightElementOutsidePressable={props.canDeleteCandidates}
                            onPress={() => props.onSelectCandidate(candidate)}
                            loading={props.linkingSessionId === candidate.remoteSessionId || props.deletingSessionId === candidate.remoteSessionId}
                            disabled={props.deletingSessionId === candidate.remoteSessionId}
                        />
                    ))}
                    {/* 失效响应保留当前视口，在用户刚操作的页尾提供同一个刷新动作。 */}
                    {props.refreshRequired ? (
                        <View testID="direct-session-candidates-footer-recovery">
                            <Text style={styles.helperText}>{t('directSessions.browseListChanged')}</Text>
                            <Item
                                testID="direct-session-candidates-footer-refresh"
                                title={t('common.refresh')}
                                onPress={props.onRefresh}
                                loading={props.loading}
                                disabled={props.loading}
                            />
                        </View>
                    ) : null}

                </>
            )}
            {/* 当前页没有筛选命中时也必须能翻到后续真实历史。 */}
                    {props.nextCursor && !props.refreshRequired ? (
                        <Item
                            testID="direct-session-candidates-load-more"
                            title={t('directSessions.browseLoadMore')}
                            onPress={props.onLoadMore}
                            loading={props.loadingMore}
                            disabled={props.loading || props.loadingMore || props.searchAugmenting}
                        />
                    ) : null}
        </ItemGroup>
    );
});

type PhoneLifecycleState = PhoneBrowseRow['lifecycle']['state'];
const STATUS_LABEL_KEYS = {
    running: 'directSessions.phoneList.running',
    needs_input: 'directSessions.phoneList.needsInput',
    completed: 'directSessions.phoneList.completed',
    failed: 'directSessions.phoneList.failed',
    cancelled: 'directSessions.phoneList.cancelled',
    unknown: 'directSessions.phoneList.unknown',
} as const;
const STATUS_ICONS: Record<Exclude<PhoneLifecycleState, 'running'>, IconName> = {
    needs_input: 'clock', completed: 'check-circle', failed: 'warning-circle', cancelled: 'x-circle', unknown: 'question',
};
const statusEasing = Easing.bezier(...MOTION_STANDARD_BEZIER);
const phoneViewabilityConfig = { itemVisiblePercentThreshold: 1 };

/** 符号只呈现已验证状态；进入视口且页面活动时运行双弧，离开或减少动态时停止。 */
function PhoneBrowseStatus(props: Readonly<{ state: PhoneLifecycleState; color: string; animate: boolean }>) {
    const rotation = useSharedValue(0);
    const opacity = useSharedValue(1);
    const previousState = React.useRef(props.state);
    const running = props.state === 'running';
    React.useEffect(() => {
        if (!props.animate || !running) {
            cancelAnimation(rotation);
            rotation.value = 0;
            return;
        }
        rotation.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1, false);
        return () => cancelAnimation(rotation);
    }, [props.animate, rotation, running]);
    React.useEffect(() => {
        const changed = previousState.current !== props.state;
        previousState.current = props.state;
        cancelAnimation(opacity);
        if (changed && props.animate) {
            opacity.value = 0.35;
            opacity.value = withTiming(1, { duration: motionTokens.durationMs.base, easing: statusEasing });
        } else {
            opacity.value = 1;
        }
        return () => cancelAnimation(opacity);
    }, [opacity, props.animate, props.state]);
    const rotationStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
    const opacityStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
    return <Animated.View accessible={false} style={[stylesheet.phoneStatusSlot, opacityStyle]}>
        {running ? <Animated.View style={[stylesheet.phoneRunningArc, rotationStyle]} />
            : <Icon name={STATUS_ICONS[props.state as Exclude<PhoneLifecycleState, 'running'>]} size={20} weight={props.state === 'completed' ? 'fill' : 'regular'} color={props.color} />}
    </Animated.View>;
}

/** 两行显示标题、时间与真实来源，状态文字覆盖全部结果，长标题随字体自然增高。 */
function PhoneBrowseCandidateRow(props: Readonly<{ row: PhoneBrowseRow; nowMs: number; animate: boolean; openingKey: string | null; onSelectRow: (row: PhoneBrowseRow) => Promise<void> }>) {
    const { row } = props;
    const { theme } = useUnistyles();
    const title = buildDirectBrowseCandidateDisplayTitle(row.candidate);
    const state = row.lifecycle.state;
    const status = t(STATUS_LABEL_KEYS[state]);
    const color = state === 'running' ? theme.colors.accent.blue
        : state === 'needs_input' ? theme.colors.accent.orange
        : state === 'completed' ? theme.colors.state.success.foreground
        : state === 'failed' ? theme.colors.state.danger.foreground : theme.colors.text.secondary;
    const opening = props.openingKey === row.key || row.snapshot.linkingSessionId === row.candidate.remoteSessionId;
    const disabled = props.openingKey !== null || row.snapshot.linkingSessionId !== null;
    return <Pressable
        testID={`phone-session:${row.key}`}
        accessibilityRole="button"
        accessibilityLabel={`${title}，${row.sourceLabel}，${status}`}
        accessibilityState={{ busy: opening, disabled }}
        disabled={disabled}
        onPress={() => { void props.onSelectRow(row); }}
        style={({ pressed }) => [stylesheet.phoneRow, pressed ? stylesheet.phoneRowPressed : null]}
    >
        <PhoneBrowseStatus state={state} color={color} animate={props.animate} />
        <View style={stylesheet.phoneRowBody}>
            <View style={stylesheet.phoneTitleLine}>
                <Text style={stylesheet.phoneTitle}>{title}</Text>
                {opening ? <ActivitySpinner size="small" color={theme.colors.text.secondary} animationEnabled={props.animate} /> : <Text style={stylesheet.phoneMeta}>{row.timeMs === null ? '—' : formatRelativeTimeShort(row.timeMs, props.nowMs)}</Text>}
            </View>
            <View style={stylesheet.phoneTitleLine}>
                <Text style={stylesheet.phoneSource}>{row.sourceLabel}</Text>
                <Text testID={`phone-session-status:${row.key}`} style={[stylesheet.phoneMeta, { color }]}>{status}</Text>
            </View>
        </View>
    </Pressable>;
}

/** 多电脑共用唯一列表；阅读时只保留键的顺序，候选、状态和点击动作始终取当前 owner 对象。 */
export function PhoneDirectBrowseCandidatesList(props: Readonly<{
    rows: readonly PhoneBrowseRow[];
    nowMs: number;
    motionActive?: boolean;
    openingKey: string | null;
    onSelectRow: (row: PhoneBrowseRow) => Promise<void>;
    loading: boolean;
    loadingMore: boolean;
    incomplete: boolean;
    hasMore: boolean;
    canLoadMore: boolean;
    canRefresh: boolean;
    hasSearch: boolean;
    onRefresh: () => Promise<void>;
    onLoadMore: () => void;
}>) {
    const { theme } = useUnistyles();
    const bottomChromeHeight = useSessionCockpitBottomChromeHeight();
    const reducedMotion = useReducedMotionPreference();
    const [readingBelowTop, setReadingBelowTop] = React.useState(false);
    const readingBelowTopRef = React.useRef(false);
    const orderRef = React.useRef<readonly string[]>([]);
    const [visibleKeys, setVisibleKeys] = React.useState<ReadonlySet<string>>(() => new Set());
    const [manualRefreshing, setManualRefreshing] = React.useState(false);
    const refreshPending = React.useRef(false);
    const mounted = React.useRef(true);
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const rows = React.useMemo(() => {
        if (!readingBelowTop) return props.rows;
        const byKey = new Map(props.rows.map((row) => [row.key, row]));
        const ordered: PhoneBrowseRow[] = [];
        for (const key of orderRef.current) {
            const row = byKey.get(key);
            if (row) ordered.push(row);
            byKey.delete(key);
        }
        // 新行追加在阅读区域后；已移除的键不会留在展示缓存里。
        ordered.push(...byKey.values());
        return ordered;
    }, [props.rows, readingBelowTop]);
    React.useLayoutEffect(() => { orderRef.current = rows.map((row) => row.key); }, [rows]);
    /** 只在进入阅读区或回到顶部时更新展示状态，滚动帧不写入 React 状态。 */
    const onScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const belowTop = event.nativeEvent.contentOffset.y > 0;
        if (readingBelowTopRef.current === belowTop) return;
        readingBelowTopRef.current = belowTop;
        setReadingBelowTop(belowTop);
    }, []);
    /** 由原 FlatList 的可见性回调暂停屏外旋转，不增加轮询或独立视口 owner。 */
    const onViewableItemsChanged = React.useCallback(({ viewableItems }: { viewableItems: ViewToken<PhoneBrowseRow>[] }) => {
        const next = new Set(viewableItems.filter((token) => token.isViewable).map((token) => token.item.key));
        setVisibleKeys((current) => current.size === next.size && [...current].every((key) => next.has(key)) ? current : next);
    }, []);
    /** 手动刷新才显示下拉进度；原请求 owner 仍处理单飞、失败与分页。 */
    const refresh = React.useCallback(async () => {
        if (refreshPending.current) return;
        refreshPending.current = true;
        setManualRefreshing(true);
        try { await props.onRefresh(); }
        finally {
            refreshPending.current = false;
            if (mounted.current) setManualRefreshing(false);
        }
    }, [props.onRefresh]);
    const animate = props.motionActive === true && !reducedMotion;
    const renderRow = React.useCallback(({ item }: ListRenderItemInfo<PhoneBrowseRow>) => <PhoneBrowseCandidateRow row={item} nowMs={props.nowMs} animate={animate && visibleKeys.has(item.key)} openingKey={props.openingKey} onSelectRow={props.onSelectRow} />, [props.nowMs, animate, visibleKeys, props.openingKey, props.onSelectRow]);
    const keyForRow = React.useCallback((row: PhoneBrowseRow) => row.key, []);
    const extraData = React.useMemo(() => ({ nowMs: props.nowMs, animate, visibleKeys, openingKey: props.openingKey, onSelectRow: props.onSelectRow }), [props.nowMs, animate, visibleKeys, props.openingKey, props.onSelectRow]);
    const footer = <View>
        {props.incomplete ? <Pressable testID="phone-sessions-retry" accessibilityRole="button" onPress={() => { void refresh(); }} disabled={!props.canRefresh} style={stylesheet.phoneFooter}>
            <Text style={stylesheet.phoneAction}>{t(!props.canRefresh && props.loading ? 'directSessions.phoneList.loading' : 'directSessions.phoneList.incomplete')}</Text>
        </Pressable> : null}
        {props.hasMore ? <Pressable testID="phone-sessions-load-more" accessibilityRole="button" onPress={props.onLoadMore} disabled={!props.canLoadMore} style={stylesheet.phoneFooter}>
            <Text style={stylesheet.phoneAction}>{t(props.loadingMore ? 'directSessions.phoneList.loadingMore' : 'directSessions.browseLoadMore')}</Text>
        </Pressable> : null}
    </View>;
    const empty = <View testID="phone-sessions-empty" style={stylesheet.loadingRow}>
        {props.loading ? <ActivitySpinner size="small" color={theme.colors.text.secondary} animationEnabled={animate} /> : <Text style={stylesheet.helperText}>
            {t(props.incomplete ? 'directSessions.phoneList.emptyIncomplete' : props.hasMore ? 'directSessions.phoneList.emptyPage' : props.hasSearch ? 'directSessions.browseNoSearchResults' : 'directSessions.phoneList.empty')}
        </Text>}
    </View>;
    return <FlatList
        testID="phone-sessions-list"
        style={stylesheet.phoneList}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 + bottomChromeHeight }}
        scrollIndicatorInsets={{ bottom: bottomChromeHeight }}
        data={rows}
        extraData={extraData}
        keyExtractor={keyForRow}
        renderItem={renderRow}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 1 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={phoneViewabilityConfig}
        refreshing={manualRefreshing}
        onRefresh={() => { void refresh(); }}
    />;
}
