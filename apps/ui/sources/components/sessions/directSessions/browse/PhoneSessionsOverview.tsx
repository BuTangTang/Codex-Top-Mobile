import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AppState, Pressable, View, StyleSheet as NativeStyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { Header } from '@/components/navigation/Header';
import { BrandLogo } from '@/components/ui/navigation/BrandLogo';
import { ITEM_TITLE_TEXT_METRICS, ITEM_SUBTITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { Typography } from '@/constants/Typography';
import { useAllMachines } from '@/sync/domains/state/storage';
import { useActiveServerAccountScope, useProfile, useSettings, useSocketStatus } from '@/sync/store/hooks';
import { useSessionListRuntimeNowMs } from '@/hooks/session/sessionListRuntimeClock';
import { resolveDirectBrowseSourceOptions } from './resolveDirectBrowseSourceOptions';
import { usePhoneMachineProjects } from '@/components/settings/machines/usePhoneMachineProjects';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';
import { PhoneDirectBrowseCandidatesList } from './DirectBrowseCandidatesList';
import { PhoneBrowseSourceOwner } from './PhoneBrowseSourceOwner';
import { aggregatePhoneBrowseSources, type PhoneBrowseRow, type PhoneBrowseSnapshot, type PhoneBrowseSource } from './phoneBrowseAggregation';
import { t } from '@/text';
import { stableJsonStringify } from '@/utils/json/stableJsonStringify';

/** 首页只保留一个紧凑标题栏和按需搜索，颜色与字号沿用应用语义规范。 */
const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface.base },
    header: { backgroundColor: theme.colors.surface.base, borderBottomWidth: NativeStyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.default },
    headerContent: { paddingHorizontal: 8, paddingVertical: 4, minHeight: 48, height: 'auto' },
    title: { flex: 1, textAlign: 'center', color: theme.colors.text.primary, ...ITEM_TITLE_TEXT_METRICS.comfortable, ...Typography.default('semiBold') },
    iconHit: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    search: { marginHorizontal: 16, marginVertical: 8, minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.colors.input.background, color: theme.colors.input.text, ...ITEM_TITLE_TEXT_METRICS.cozy },
    hint: { paddingHorizontal: 16, paddingVertical: 10, color: theme.colors.text.secondary, ...ITEM_SUBTITLE_TEXT_METRICS.cozy },
}));

/** 同一个标题栏覆盖正常列表和账号范围错误，保留安全区、原 Logo 与可选搜索。 */
function PhoneSessionsHeader(props: Readonly<{ title?: string; searchOpen?: boolean; onToggleSearch?: () => void }>) {
    const { theme } = useUnistyles();
    return <Header
        title={<Text testID="phone-sessions-title" accessibilityRole="header" style={styles.title}>{props.title ?? t('tabs.sessions')}</Text>}
        headerLeft={() => <View style={styles.iconHit}><BrandLogo testID="phone-sessions-logo" size={24} /></View>}
        headerRight={() => props.onToggleSearch ? <Pressable testID="phone-sessions-search-toggle" accessibilityRole="button" accessibilityLabel={t(props.searchOpen ? 'common.close' : 'sessionsList.searchSessions')} accessibilityState={{ expanded: props.searchOpen }} style={styles.iconHit}
            onPress={props.onToggleSearch}>
            <Icon name={props.searchOpen ? 'x' : 'magnifying-glass'} size={20} color={theme.colors.text.primary} />
        </Pressable> : <View style={styles.iconHit} />}
        headerStyle={styles.header}
        headerContentStyle={styles.headerContent}
        headerShadowVisible={false}
    />;
}

/** 账号、服务器或明确路由范围变化时重挂，防止旧身份的候选和动作流入新入口。 */
export function PhoneSessionsOverview() {
    const scope = useActiveServerAccountScope();
    const params = useLocalSearchParams<{ machineId?: string; serverId?: string; projectId?: string; sourceKey?: string }>();
    const machineId = typeof params.machineId === 'string' ? params.machineId : undefined;
    if (!scope) return <View style={styles.screen}><PhoneSessionsHeader /><Text style={styles.hint}>尚未连接账号</Text></View>;
    if (params.serverId !== undefined && params.serverId !== scope.serverId) {
        return <View style={styles.screen}><PhoneSessionsHeader /><Text testID="phone-sessions-unavailable" style={styles.hint}>电脑不属于当前连接，请返回电脑列表重新选择。</Text></View>;
    }
    if (params.machineId !== undefined && !machineId?.trim()) {
        return <View style={styles.screen}><PhoneSessionsHeader /><Text testID="phone-sessions-machine-unavailable" style={styles.hint}>电脑范围已失效，请返回电脑列表重新选择。</Text></View>;
    }
    const hasProjectParams = params.projectId !== undefined || params.sourceKey !== undefined;
    if (hasProjectParams && (!machineId || typeof params.projectId !== 'string' || !params.projectId.trim() || typeof params.sourceKey !== 'string' || !params.sourceKey.trim())) {
        return <View style={styles.screen}><PhoneSessionsHeader /><Text testID="phone-sessions-project-unavailable" style={styles.hint}>项目范围已失效，请返回电脑列表重新选择。</Text></View>;
    }
    const projectKey = hasProjectParams ? JSON.stringify([params.sourceKey, params.projectId]) : undefined;
    return <ScopedPhoneSessionsOverview key={JSON.stringify([scope.serverId, scope.accountId, machineId, projectKey])} serverId={scope.serverId} accountId={scope.accountId} machineId={machineId} projectKey={projectKey} />;
}

/** 首页统一展示同账号电脑；电脑页带入的明确范围则展示该范围全部真实历史。 */
function ScopedPhoneSessionsOverview(scope: Readonly<{ serverId: string; accountId: string; machineId?: string; projectKey?: string }>) {
    const focused = useIsFocused();
    const socket = useSocketStatus();
    const [appActive, setAppActive] = React.useState(AppState.currentState === 'active');
    const observationGenerationRef = React.useRef(0);
    const [observationScope, setObservationScope] = React.useState(() => ({
        isCurrent: () => appActive && observationGenerationRef.current === 0,
    }));
    /** 原生前后台边界同步作废旧范围；即使事件被 React 合并，也不能复用休眠前观测。 */
    React.useEffect(() => {
        let active = appActive;
        /** 只在真实活动状态切换时换代，重复通知不打断当前请求。 */
        const updateAppState = (state: string) => {
            const nextActive = state === 'active';
            if (active !== nextActive) {
                active = nextActive;
                const generation = ++observationGenerationRef.current;
                setObservationScope({ isCurrent: () => nextActive && observationGenerationRef.current === generation });
            }
            setAppActive(nextActive);
        };
        updateAppState(AppState.currentState);
        const subscription = AppState.addEventListener('change', updateAppState);
        return () => subscription.remove();
    }, []);
    const discoveryEnabled = focused && appActive && socket.status === 'connected';
    const { theme } = useUnistyles();
    const machines = useAllMachines();
    const profile = useProfile();
    const settings = useSettings();
    useSessionListRuntimeNowMs();
    // 公共时钟负责重绘；墙钟用于相对展示，候选缓存年龄由其单调观测独立计算。
    const nowMs = Date.now();
    const [query, setQuery] = React.useState('');
    const [searchOpen, setSearchOpen] = React.useState(false);
    const [snapshots, setSnapshots] = React.useState<Readonly<Record<string, PhoneBrowseSnapshot | undefined>>>({});
    const actionPending = React.useRef(false);
    const openingKeyRef = React.useRef<string | null>(null);
    const [openingKey, setOpeningKey] = React.useState<string | null>(null);
    /** 同步动作门禁覆盖 setState 提交前的计时器回调，并暂停所有来源。 */
    const isOpening = React.useCallback(() => openingKeyRef.current !== null, []);
    const mountedRef = React.useRef(true);
    React.useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    const history = Boolean(scope.machineId);
    const visibleMachines = React.useMemo(() => scope.machineId ? machines.filter((machine) => machine.id === scope.machineId) : machines, [machines, scope.machineId]);
    const sourceOptions = React.useMemo(() => resolveDirectBrowseSourceOptions({ providerId: 'codex', profile, settings }), [profile, settings]);
    const sources = React.useMemo<PhoneBrowseSource[]>(() => visibleMachines.flatMap((machine) => sourceOptions.map((option) => ({
        key: stableJsonStringify([scope.serverId, scope.accountId, machine.id, option.key, option.source]),
        machineId: machine.id, machineLabel: getMachineDisplayName(machine) ?? '电脑',
        sourceKey: option.key, source: option.source, online: isMachineOnline(machine, nowMs),
    }))), [visibleMachines, sourceOptions, scope.serverId, scope.accountId, nowMs]);
    const selectedComputer = scope.machineId ? visibleMachines[0] : null;
    const projectState = usePhoneMachineProjects({ machineId: selectedComputer?.id ?? null, serverId: scope.serverId, enabled: Boolean(scope.projectKey && selectedComputer && isMachineOnline(selectedComputer, nowMs)) });
    const selectedProject = projectState.projects?.find((project) => JSON.stringify([project.sourceKey, project.id]) === scope.projectKey);
    const projectUnavailable = Boolean(scope.projectKey && projectState.projects !== null && (!selectedProject || !selectedProject.available));

    /** 只保存 owner 已发布的当前快照，卸载会立即删除该来源，不缓存另一套候选。 */
    const publishSnapshot = React.useCallback((key: string, snapshot: PhoneBrowseSnapshot | null) => {
        setSnapshots((current) => {
            if (current[key] === (snapshot ?? undefined)) return current;
            if (snapshot) return { ...current, [key]: snapshot };
            const next = { ...current };
            delete next[key];
            return next;
        });
    }, []);
    const aggregate = React.useMemo(() => aggregatePhoneBrowseSources({
        ...scope, sources, snapshots, phase: null, nowMs,
        projectRequired: Boolean(scope.projectKey), project: selectedProject,
    }), [scope.serverId, scope.accountId, scope.projectKey, sources, snapshots, nowMs, selectedProject, observationScope]);

    /** 用户明确刷新时复用现有 owner；单飞防止下拉和重试同时重启同一请求。 */
    const refresh = React.useCallback(async () => {
        if (actionPending.current) return;
        actionPending.current = true;
        try {
            await Promise.allSettled([
                ...aggregate.refreshSources.map((snapshot) => snapshot.refresh()),
                ...(scope.projectKey ? [projectState.refresh()] : []),
            ]);
        } finally { actionPending.current = false; }
    }, [aggregate.refreshSources, projectState.refresh, scope.projectKey]);

    /** 合并页尾只向仍有有效游标的 owner 翻页，失败与旧游标恢复由原 owner 处理。 */
    const loadMore = React.useCallback(async () => {
        if (actionPending.current) return;
        actionPending.current = true;
        try { await Promise.allSettled(aggregate.loadMoreSources.map((snapshot) => snapshot.loadMore())); }
        finally { actionPending.current = false; }
    }, [aggregate.loadMoreSources]);

    /** 跨电脑也只允许一次打开；失败或完成释放门禁，旧账号卸载后不改新页面状态。 */
    const openRow = React.useCallback(async (row: PhoneBrowseRow) => {
        if (openingKeyRef.current !== null) return;
        openingKeyRef.current = row.key;
        setOpeningKey(row.key);
        try { await row.snapshot.selectCandidate(row.candidate); }
        finally {
            openingKeyRef.current = null;
            if (mountedRef.current) setOpeningKey(null);
        }
    }, []);

    return <View testID="phone-sessions-overview" style={styles.screen}>
        <PhoneSessionsHeader title={history ? selectedProject?.name || t('directSessions.browseCandidates') : undefined}
            searchOpen={searchOpen} onToggleSearch={() => setSearchOpen((open) => !open)} />
        {searchOpen ? <TextInput testID="phone-sessions-search" accessibilityLabel={t('sessionsList.searchSessions')} placeholder={t('directSessions.browseSearchPlaceholder')} placeholderTextColor={theme.colors.input.placeholder} value={query} onChangeText={setQuery} style={styles.search} /> : null}
        {machines.length === 0 ? <Text style={styles.hint}>还没有连接的电脑，请在电脑端登录同一账号。</Text> : null}
        {scope.machineId && visibleMachines.length === 0 ? <Text testID="phone-sessions-machine-unavailable" style={styles.hint}>当前账号下没有所选电脑，请返回重新选择。</Text> : null}
        {scope.projectKey && projectState.loading && !projectState.projects ? <Text style={styles.hint}>{t('codexTopProjects.loading')}</Text> : null}
        {projectUnavailable ? <Text testID="phone-sessions-project-unavailable" style={styles.hint}>{t('codexTopProjects.missing')}</Text> : null}
        {scope.projectKey && selectedComputer && !isMachineOnline(selectedComputer, nowMs) ? <Text style={styles.hint}>{t('codexTopProjects.offline')}</Text> : null}
        {sources.map((source) => <PhoneBrowseSourceOwner key={source.key} source={source} serverId={scope.serverId} searchQuery={searchOpen ? query : ''}
            discoveryEnabled={discoveryEnabled && source.online} observationScope={observationScope} actionPending={openingKey !== null} isActionPending={isOpening} onSnapshot={publishSnapshot} />)}
        <PhoneDirectBrowseCandidatesList rows={aggregate.rows} nowMs={nowMs} motionActive={focused && appActive}
            openingKey={openingKey} onSelectRow={openRow}
            loading={aggregate.loading || Boolean(scope.projectKey && projectState.loading)} loadingMore={aggregate.loadingMore}
            incomplete={aggregate.incomplete || Boolean(projectState.error)} hasMore={aggregate.hasMore} hasSearch={searchOpen && Boolean(query.trim())}
            canLoadMore={aggregate.loadMoreSources.length > 0} canRefresh={aggregate.refreshSources.length > 0 || Boolean(scope.projectKey && !projectState.loading)}
            onRefresh={refresh} onLoadMore={() => { void loadMore(); }} />
    </View>;
}
