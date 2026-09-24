import * as React from 'react';
import type { ScrollView } from 'react-native';
import type { DirectSessionsProviderId, DirectSessionsSource } from '@happier-dev/protocol';

import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getAgentCore } from '@/agents/catalog/catalog';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { PopoverScope } from '@/components/ui/popover';
import { Modal } from '@/modal';
import { useAllMachines } from '@/sync/domains/state/storage';
import { machineDirectSessionCandidateDelete, machineDirectSessionLinkEnsure } from '@/sync/ops/machineDirectSessions';
import { useActiveServerAccountScope, useProfile, useSettings } from '@/sync/store/hooks';
import type { Theme } from '@/theme';
import { t } from '@/text';

import { readDirectBrowseCandidatePath } from './buildDirectBrowseCandidatePresentation';
import { getPreferredDirectBrowseProviderId } from './getPreferredDirectBrowseProviderId';
import {
    listDirectBrowseProviderIds,
    resolveDirectBrowseLinkEnsureRequestExtras,
    resolveDirectBrowseSourceOptions,
} from './resolveDirectBrowseSourceOptions';
import { DirectBrowseCandidatesList } from './DirectBrowseCandidatesList';
import { shouldUseCandidateSource } from './shouldUseCandidateSource';
import { useDirectBrowseCandidates, type DirectBrowseCandidate } from './useDirectBrowseCandidates';
import { Icon } from '@/components/ui/icons/Icon';
import type { PhoneBrowseSnapshot } from './phoneBrowseAggregation';

type DirectBrowseProviderId = DirectSessionsProviderId;
type AppTheme = Theme;

const DIRECT_BROWSE_SEARCH_DEBOUNCE_MS = 250;

export type DirectSessionsBrowseScopeLock = Readonly<{
    machineId: string;
    serverId?: string | null;
    providerId: DirectSessionsProviderId;
    source: DirectSessionsSource;
}>;

export type DirectSessionsBrowseInteraction = 'openSession' | 'pickRemoteSessionId';

function getPreferredMachineId(
    machines: readonly Readonly<{ id: string; active?: boolean }>[],
    selectedMachineId: string | null,
): string | null {
    const firstMachineId = machines[0]?.id ?? null;
    if (!firstMachineId) return null;
    if (selectedMachineId && machines.some((machine) => machine.id === selectedMachineId)) {
        return selectedMachineId;
    }
    return machines.find((machine) => machine.active)?.id ?? firstMachineId;
}

const stylesheet = StyleSheet.create((theme: AppTheme) => ({
    list: {
        paddingTop: 0,
    },
    filtersGroup: {
        marginTop: 0,
    },
    filtersGroupContainer: {
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        shadowOpacity: 0,
        elevation: 0,
        marginHorizontal: 12,
    },
}));

/** 桌面保留完整浏览器，手机嵌入同一候选与打开流程，避免产生第二套查询。 */
export const DirectSessionsBrowseScreen = React.memo((props: Readonly<{
    phoneData?: Readonly<{
        searchQuery: string;
        onSnapshot: (snapshot: PhoneBrowseSnapshot | null) => void;
    }>;
    phonePresentation?: Readonly<{
        searchQuery: string;
        includeCandidate: (candidate: DirectBrowseCandidate) => boolean;
    }>;
    interaction?: DirectSessionsBrowseInteraction;
    lockScope?: DirectSessionsBrowseScopeLock | null;
    onPickRemoteSessionId?: (remoteSessionId: string) => void;
}>) => {
    const interaction: DirectSessionsBrowseInteraction = props.interaction ?? 'openSession';
    const lockScope = props.lockScope ?? null;
    const locked = Boolean(lockScope);
    const navigateToSession = useNavigateToSession();
    const { theme } = useUnistyles() as { theme: AppTheme };
    const styles = stylesheet;
    const machines = useAllMachines();
    const profile = useProfile();
    const settings = useSettings();
    // 未锁定来源时也固定实际服务器，让切换服务器作废旧分页回包。
    const activeScope = useActiveServerAccountScope();
    const browseServerId = lockScope?.serverId ?? activeScope?.serverId ?? null;
    // 手机账号作用域卸载后忽略旧打开结果，避免把新账号导航到旧账号任务。
    const mountedRef = React.useRef(true);
    React.useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    const providers = React.useMemo<ReadonlyArray<Readonly<{ id: DirectBrowseProviderId; label: string }>>>(
        () => listDirectBrowseProviderIds().map((providerId) => ({
            id: providerId,
            label: t(getAgentCore(providerId).displayNameKey),
        })),
        [],
    );
    const providerIds = React.useMemo<readonly DirectBrowseProviderId[]>(() => providers.map((provider) => provider.id), [providers]);
    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(() => (
        lockScope?.machineId ?? getPreferredMachineId(machines, null)
    ));
    const [selectedProviderId, setSelectedProviderId] = React.useState<DirectBrowseProviderId | null>(() => (
        lockScope?.providerId ?? getPreferredDirectBrowseProviderId(providerIds, null)
    ));
    const sourceOptions = React.useMemo(() => {
        if (lockScope) {
            return [{
                key: 'locked',
                label: t('directSessions.browseSources'),
                source: lockScope.source,
            }];
        }
        if (!selectedProviderId) return [];
        return resolveDirectBrowseSourceOptions({
            providerId: selectedProviderId,
            profile,
            settings,
        });
    }, [lockScope, profile, selectedProviderId, settings]);
    const [selectedSourceKey, setSelectedSourceKey] = React.useState<string | null>(() => (
        lockScope ? 'locked' : sourceOptions[0]?.key ?? null
    ));
    const [linkingSessionId, setLinkingSessionId] = React.useState<string | null>(null);
    const [deletingSessionId, setDeletingSessionId] = React.useState<string | null>(null);
    const [localSearchQuery, setSearchQuery] = React.useState('');
    const searchQuery = props.phoneData?.searchQuery ?? props.phonePresentation?.searchQuery ?? localSearchQuery;
    const [candidateSearchTerm, setCandidateSearchTerm] = React.useState('');
    const [machineMenuOpen, setMachineMenuOpen] = React.useState(false);
    const [providerMenuOpen, setProviderMenuOpen] = React.useState(false);
    const [sourceMenuOpen, setSourceMenuOpen] = React.useState(false);
    const popoverBoundaryRef = React.useRef<ScrollView>(null);
    const effectiveSelectedMachineId = React.useMemo(() => {
        if (lockScope) return lockScope.machineId;
        return getPreferredMachineId(machines, selectedMachineId);
    }, [lockScope, machines, selectedMachineId]);

    React.useEffect(() => {
        if (lockScope) return;
        if (effectiveSelectedMachineId && effectiveSelectedMachineId !== selectedMachineId) {
            setSelectedMachineId(effectiveSelectedMachineId);
        }
    }, [effectiveSelectedMachineId, lockScope, selectedMachineId]);

    React.useEffect(() => {
        if (lockScope) return;
        const preferredProviderId = getPreferredDirectBrowseProviderId(providerIds, selectedProviderId);
        if (preferredProviderId !== selectedProviderId) {
            setSelectedProviderId(preferredProviderId);
        }
    }, [lockScope, providerIds, selectedProviderId]);

    React.useEffect(() => {
        const normalizedSearchQuery = searchQuery.trim();
        if (!normalizedSearchQuery) {
            setCandidateSearchTerm('');
            return;
        }

        const timeout = setTimeout(() => {
            setCandidateSearchTerm(normalizedSearchQuery);
        }, DIRECT_BROWSE_SEARCH_DEBOUNCE_MS);

        return () => {
            clearTimeout(timeout);
        };
    }, [searchQuery]);

    React.useEffect(() => {
        if (lockScope) {
            if (selectedSourceKey !== 'locked') {
                setSelectedSourceKey('locked');
            }
            return;
        }
        const defaultKey = sourceOptions[0]?.key ?? null;
        if (!defaultKey) {
            setSelectedSourceKey(null);
            return;
        }
        const hasSelectedSource = sourceOptions.some((option) => option.key === selectedSourceKey);
        if (!hasSelectedSource) {
            setSelectedSourceKey(defaultKey);
        }
    }, [lockScope, selectedSourceKey, sourceOptions]);

    const selectedSource = React.useMemo(
        () => lockScope?.source ?? sourceOptions.find((option) => option.key === selectedSourceKey)?.source ?? sourceOptions[0]?.source ?? null,
        [lockScope, selectedSourceKey, sourceOptions],
    );
    const machineMenuItems = React.useMemo(() => machines.map((machine) => ({
        id: machine.id,
        title: machine.metadata?.displayName || machine.metadata?.host || machine.id,
        subtitle: machine.active ? t('status.activeNow') : t('status.offline'),
        icon: <Icon name="desktop" size={16} color={theme.colors.text.secondary} />,
    })), [machines, theme.colors.text.secondary]);
    const providerMenuItems = React.useMemo(() => providers.map((provider) => ({
        id: provider.id,
        title: provider.label,
        icon: <Icon name="cpu" size={16} color={theme.colors.text.secondary} />,
    })), [providers, theme.colors.text.secondary]);
    const sourceMenuItems = React.useMemo(() => sourceOptions.map((sourceOption) => ({
        id: sourceOption.key,
        title: sourceOption.label,
        subtitle: sourceOption.detail,
        icon: <Icon name="folder-open" size={16} color={theme.colors.text.secondary} />,
    })), [sourceOptions, theme.colors.text.secondary]);
    const formatMachineTriggerSubtitle = React.useCallback((selectedItem: Readonly<{ title: string; subtitle?: React.ReactNode }> | null) => {
        if (!selectedItem) return null;
        const statusLabel = typeof selectedItem.subtitle === 'string' ? selectedItem.subtitle.trim() : '';
        return statusLabel ? `${selectedItem.title} · ${statusLabel}` : selectedItem.title;
    }, []);
    const formatSelectedTitleSubtitle = React.useCallback((selectedItem: Readonly<{ title: string }> | null) => {
        return selectedItem?.title ?? null;
    }, []);

    const {
        candidates,
        nextCursor,
        loading,
        loadingMore,
        searchAugmenting,
        searchIncomplete,
        refreshRequired,
        refresh,
        error,
        canDeleteCandidates,
        loadMore,
        removeCandidate,
    } = useDirectBrowseCandidates({
        machineId: effectiveSelectedMachineId,
        serverId: browseServerId,
        providerId: selectedProviderId,
        source: selectedSource,
        searchTerm: candidateSearchTerm,
    });

    const providerLabel = selectedProviderId
        ? t(getAgentCore(selectedProviderId).displayNameKey)
        : '';

    const handleDeleteCandidate = React.useCallback(async (candidate: DirectBrowseCandidate) => {
        if (!effectiveSelectedMachineId || !selectedProviderId || !selectedSource || deletingSessionId) return;
        setDeletingSessionId(candidate.remoteSessionId);
        try {
            const request = {
                machineId: effectiveSelectedMachineId,
                providerId: selectedProviderId,
                source: selectedSource,
                remoteSessionId: candidate.remoteSessionId,
            };
            const result = lockScope?.serverId
                ? await machineDirectSessionCandidateDelete(request, { serverId: lockScope.serverId })
                : await machineDirectSessionCandidateDelete(request);
            if (!result.ok) {
                Modal.alert(t('common.error'), result.error);
                return;
            }
            removeCandidate(candidate.remoteSessionId);
        } catch (deleteError) {
            Modal.alert(
                t('common.error'),
                deleteError instanceof Error ? deleteError.message : t('directSessions.deleteCandidateFailed'),
            );
        } finally {
            setDeletingSessionId(null);
        }
    }, [deletingSessionId, effectiveSelectedMachineId, lockScope?.serverId, removeCandidate, selectedProviderId, selectedSource]);

    /** 使用候选实际来源打开原会话，禁止创建替代 runner。 */
    const handleOpenCandidate = React.useCallback(async (candidate: DirectBrowseCandidate) => {
        if (!effectiveSelectedMachineId || !selectedProviderId || !selectedSource) return;
        if (interaction === 'pickRemoteSessionId') {
            props.onPickRemoteSessionId?.(candidate.remoteSessionId);
            return;
        }
        setLinkingSessionId(candidate.remoteSessionId);
        try {
            const linkEnsureExtras = resolveDirectBrowseLinkEnsureRequestExtras({
                providerId: selectedProviderId,
                source: selectedSource,
                candidate,
            });
            const candidateSource = linkEnsureExtras.source && typeof linkEnsureExtras.source === 'object'
                ? (linkEnsureExtras.source as DirectSessionsSource)
                : undefined;
            const effectiveSource: DirectSessionsSource = candidateSource && shouldUseCandidateSource(selectedSource, candidateSource)
                ? candidateSource
                : selectedSource;
            const request = {
                machineId: effectiveSelectedMachineId,
                providerId: selectedProviderId,
                remoteSessionId: candidate.remoteSessionId,
                ...(candidate.title ? { titleHint: candidate.title } : {}),
                ...(readDirectBrowseCandidatePath(candidate.details) ? { directoryHint: readDirectBrowseCandidatePath(candidate.details)! } : {}),
                ...linkEnsureExtras,
                source: effectiveSource,
            };
            const result = browseServerId
                ? await machineDirectSessionLinkEnsure(request, { serverId: browseServerId })
                : await machineDirectSessionLinkEnsure(request);
            if (!mountedRef.current) return;
            if (!result.ok) {
                Modal.alert(t('common.error'), result.error);
                return;
            }
            await navigateToSession(result.sessionId);
        } catch (linkError) {
            if (!mountedRef.current) return;
            Modal.alert(t('common.error'), linkError instanceof Error ? linkError.message : t('directSessions.browseLinkFailed'));
        } finally {
            if (mountedRef.current) setLinkingSessionId(null);
        }
    }, [browseServerId, effectiveSelectedMachineId, interaction, navigateToSession, props.onPickRemoteSessionId, selectedProviderId, selectedSource]);

    // 首页只订阅这个 owner 的快照及原动作；刷新、搜索与分页继续由原 hook 负责。
    const onPhoneSnapshot = props.phoneData?.onSnapshot;
    const phoneSnapshot = React.useMemo<PhoneBrowseSnapshot>(() => ({
        candidates, nextCursor, loading, loadingMore, searchAugmenting, searchIncomplete,
        refreshRequired, error, linkingSessionId, refresh, loadMore, selectCandidate: handleOpenCandidate,
    }), [candidates, nextCursor, loading, loadingMore, searchAugmenting, searchIncomplete, refreshRequired, error, linkingSessionId, refresh, loadMore, handleOpenCandidate]);
    React.useEffect(() => { onPhoneSnapshot?.(phoneSnapshot); }, [onPhoneSnapshot, phoneSnapshot]);
    React.useEffect(() => () => { onPhoneSnapshot?.(null); }, [onPhoneSnapshot]);
    if (props.phoneData) return null;

    const candidatesList = (
                <DirectBrowseCandidatesList
                    compact={Boolean(props.phonePresentation)}
                    hideSearch={Boolean(props.phonePresentation)}
                    candidates={props.phonePresentation ? candidates.filter(props.phonePresentation.includeCandidate) : candidates}
                    loading={loading}
                    error={error}
                    nextCursor={nextCursor}
                    loadingMore={loadingMore}
                    searchAugmenting={searchAugmenting}
                    searchIncomplete={searchIncomplete}
                    refreshRequired={refreshRequired}
                    onRefresh={() => { void refresh(); }}
                    linkingSessionId={linkingSessionId}
                    deletingSessionId={deletingSessionId}
                    canDeleteCandidates={!props.phonePresentation && canDeleteCandidates}
                    providerLabel={providerLabel}
                    searchQuery={searchQuery}
                    onSearchQueryChange={setSearchQuery}
                    onSelectCandidate={(candidate) => { void handleOpenCandidate(candidate); }}
                    onDeleteCandidate={(candidate) => { void handleDeleteCandidate(candidate); }}
                    onLoadMore={() => { void loadMore(); }}
                />
    );
    if (props.phonePresentation) return candidatesList;

    return (
        <PopoverScope boundaryRef={popoverBoundaryRef}>
            <ItemList ref={popoverBoundaryRef} style={styles.list} testID="direct-sessions-browse-modal">
                {!locked ? (
                    <ItemGroup
                        style={styles.filtersGroup}
                        title={t('directSessions.browseFiltersTitle')}
                        containerStyle={styles.filtersGroupContainer}
                    >
                        {machines.length === 0 ? (
                            <Item
                                title={t('directSessions.browseNoMachines')}
                                mode="info"
                            />
                        ) : (
                            <>
                                <DropdownMenu
                                    open={machineMenuOpen}
                                    onOpenChange={setMachineMenuOpen}
                                    items={machineMenuItems}
                                    selectedId={effectiveSelectedMachineId}
                                    onSelect={(itemId) => {
                                        setSelectedMachineId(itemId);
                                        setMachineMenuOpen(false);
                                    }}
                                    showCategoryTitles={false}
                                    variant="selectable"
                                    rowKind="item"
                                    matchTriggerWidth={true}
                                    connectToTrigger={true}
                                    popoverBoundaryRef={popoverBoundaryRef}
                                    itemTrigger={{
                                        title: t('directSessions.browseMachines'),
                                        icon: <Icon name="desktop" size={16} color={theme.colors.text.secondary} />,
                                        subtitleFormatter: formatMachineTriggerSubtitle,
                                        showSelectedDetail: false,
                                        itemProps: {
                                            testID: 'direct-session-machine-picker-trigger',
                                        },
                                    }}
                                />
                                <DropdownMenu
                                    open={providerMenuOpen}
                                    onOpenChange={setProviderMenuOpen}
                                    items={providerMenuItems}
                                    selectedId={selectedProviderId}
                                    onSelect={(itemId) => {
                                        setSelectedProviderId(itemId as DirectBrowseProviderId);
                                        setProviderMenuOpen(false);
                                    }}
                                    showCategoryTitles={false}
                                    variant="selectable"
                                    rowKind="item"
                                    matchTriggerWidth={true}
                                    connectToTrigger={true}
                                    popoverBoundaryRef={popoverBoundaryRef}
                                    itemTrigger={{
                                        title: t('directSessions.browseProviders'),
                                        icon: <Icon name="cpu" size={16} color={theme.colors.text.secondary} />,
                                        subtitleFormatter: formatSelectedTitleSubtitle,
                                        showSelectedDetail: false,
                                        itemProps: {
                                            testID: 'direct-session-provider-picker-trigger',
                                        },
                                    }}
                                />
                                <DropdownMenu
                                    open={sourceMenuOpen}
                                    onOpenChange={setSourceMenuOpen}
                                    items={sourceMenuItems}
                                    selectedId={selectedSourceKey}
                                    onSelect={(itemId) => {
                                        setSelectedSourceKey(itemId);
                                        setSourceMenuOpen(false);
                                    }}
                                    showCategoryTitles={false}
                                    variant="selectable"
                                    rowKind="item"
                                    matchTriggerWidth={true}
                                    connectToTrigger={true}
                                    popoverBoundaryRef={popoverBoundaryRef}
                                    itemTrigger={{
                                        title: t('directSessions.browseSources'),
                                        icon: <Icon name="folder-open" size={16} color={theme.colors.text.secondary} />,
                                        subtitleFormatter: formatSelectedTitleSubtitle,
                                        showSelectedDetail: false,
                                        itemProps: {
                                            testID: 'direct-session-source-picker-trigger',
                                        },
                                    }}
                                />
                            </>
                        )}
                    </ItemGroup>
                ) : null}

                {candidatesList}
            </ItemList>
        </PopoverScope>
    );
});
