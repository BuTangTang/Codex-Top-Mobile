import * as React from 'react';
import { FlatList, Pressable, View, type ListRenderItemInfo } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

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
    phoneRow: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 10, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.default },
    phoneRowPressed: { backgroundColor: theme.colors.surface.inset },
    phoneTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    phoneTitle: { flex: 1, fontSize: 15, color: theme.colors.text.primary },
    phoneMeta: { fontSize: 12, color: theme.colors.text.secondary },
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

/** 紧凑历史的异常状态保留原意，不伪装为运行、待处理或完成。 */
function phoneHistoryStatusLabel(row: PhoneBrowseRow): string | null {
    if (row.lifecycle.state === 'failed') return '执行失败';
    if (row.lifecycle.state === 'cancelled') return '已取消';
    if (row.lifecycle.state === 'unknown') return '状态待确认';
    return null;
}

/** 一条手机会话只占两行，保留来源 owner 的打开动作和明确的等待反馈。 */
function PhoneBrowseCandidateRow(props: Readonly<{ row: PhoneBrowseRow; nowMs: number; history: boolean; openingKey: string | null; onSelectRow: (row: PhoneBrowseRow) => Promise<void> }>) {
    const { row } = props;
    const { theme } = useUnistyles();
    const title = buildDirectBrowseCandidateDisplayTitle(row.candidate);
    const status = props.history ? phoneHistoryStatusLabel(row) : null;
    const sourceLabel = status ? `${row.sourceLabel} · ${status}` : row.sourceLabel;
    const opening = props.openingKey === row.key || row.snapshot.linkingSessionId === row.candidate.remoteSessionId;
    const disabled = props.openingKey !== null || row.snapshot.linkingSessionId !== null;
    return <Pressable
        testID={`phone-session:${row.key}`}
        accessibilityRole="button"
        accessibilityLabel={`${title}，${sourceLabel}`}
        accessibilityState={{ busy: opening, disabled }}
        disabled={disabled}
        onPress={() => { void props.onSelectRow(row); }}
        style={({ pressed }) => [stylesheet.phoneRow, pressed ? stylesheet.phoneRowPressed : null]}
    >
        <View style={stylesheet.phoneTitleLine}>
            <Text style={stylesheet.phoneTitle} numberOfLines={1}>{title}</Text>
            {opening ? <ActivitySpinner size="small" color={theme.colors.text.secondary} /> : <Text style={stylesheet.phoneMeta}>{row.timeMs === null ? '—' : formatRelativeTimeShort(row.timeMs, props.nowMs)}</Text>}
        </View>
        <Text style={stylesheet.phoneMeta} numberOfLines={1}>{sourceLabel}</Text>
    </Pressable>;
}

/** 多电脑共用唯一滚动、空态和页尾；所有翻页仍回到各来源现有的游标 owner。 */
export function PhoneDirectBrowseCandidatesList(props: Readonly<{
    rows: readonly PhoneBrowseRow[];
    nowMs: number;
    history: boolean;
    openingKey: string | null;
    onSelectRow: (row: PhoneBrowseRow) => Promise<void>;
    loading: boolean;
    loadingMore: boolean;
    incomplete: boolean;
    hasMore: boolean;
    canLoadMore: boolean;
    canRefresh: boolean;
    hasSearch: boolean;
    onRefresh: () => void;
    onLoadMore: () => void;
}>) {
    const { theme } = useUnistyles();
    const bottomChromeHeight = useSessionCockpitBottomChromeHeight();
    const renderRow = React.useCallback(({ item }: ListRenderItemInfo<PhoneBrowseRow>) => <PhoneBrowseCandidateRow row={item} nowMs={props.nowMs} history={props.history} openingKey={props.openingKey} onSelectRow={props.onSelectRow} />, [props.nowMs, props.history, props.openingKey, props.onSelectRow]);
    const keyForRow = React.useCallback((row: PhoneBrowseRow) => row.key, []);
    const footer = <View>
        {props.incomplete ? <Pressable testID="phone-sessions-retry" accessibilityRole="button" onPress={props.onRefresh} disabled={!props.canRefresh} style={stylesheet.phoneFooter}>
            <Text style={stylesheet.phoneAction}>{!props.canRefresh && props.loading ? '正在同步…' : '部分会话未同步 · 重试'}</Text>
        </Pressable> : null}
        {props.hasMore ? <Pressable testID="phone-sessions-load-more" accessibilityRole="button" onPress={props.onLoadMore} disabled={!props.canLoadMore} style={stylesheet.phoneFooter}>
            <Text style={stylesheet.phoneAction}>{props.loadingMore ? '正在加载…' : '继续加载'}</Text>
        </Pressable> : null}
        {!props.incomplete && props.rows.length > 0 && props.loading ? <View style={stylesheet.phoneFooter}><ActivitySpinner size="small" color={theme.colors.text.secondary} /></View> : null}
    </View>;
    const empty = <View testID="phone-sessions-empty" style={stylesheet.loadingRow}>
        {props.loading ? <ActivitySpinner size="small" color={theme.colors.text.secondary} /> : <Text style={stylesheet.helperText}>
            {props.incomplete ? '已同步的会话中暂无匹配项' : props.hasMore ? '当前页暂无匹配会话' : props.hasSearch ? '没有匹配的会话' : props.history ? '暂无历史会话' : '暂无这类会话'}
        </Text>}
    </View>;
    return <FlatList
        testID="phone-sessions-list"
        style={stylesheet.phoneList}
        contentContainerStyle={{ paddingBottom: 16 + bottomChromeHeight }}
        scrollIndicatorInsets={{ bottom: bottomChromeHeight }}
        data={props.rows}
        keyExtractor={keyForRow}
        renderItem={renderRow}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        keyboardShouldPersistTaps="handled"
        refreshing={props.loading}
        onRefresh={props.onRefresh}
    />;
}
