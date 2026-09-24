import * as React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { MOTION_STANDARD_BEZIER, motionTokens } from '@/components/ui/motion/motionTokens';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useAllMachines } from '@/sync/domains/state/storage';
import { useActiveServerAccountScope, useProfile, useSettings } from '@/sync/store/hooks';
import { useSessionListRuntimeNowMs } from '@/hooks/session/sessionListRuntimeClock';
import { resolveDirectBrowseSourceOptions } from './resolveDirectBrowseSourceOptions';
import { usePhoneMachineProjects } from '@/components/settings/machines/usePhoneMachineProjects';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';
import { PhoneDirectBrowseCandidatesList } from './DirectBrowseCandidatesList';
import { PhoneBrowseSourceOwner } from './PhoneBrowseSourceOwner';
import { aggregatePhoneBrowseSources, type PhoneBrowsePhase, type PhoneBrowseRow, type PhoneBrowseSnapshot, type PhoneBrowseSource } from './phoneBrowseAggregation';
import { t } from '@/text';
import { stableJsonStringify } from '@/utils/json/stableJsonStringify';

const PHASES = [{ id: 'running', label: '运行中' }, { id: 'needs_input', label: '待处理' }, { id: 'completed', label: '已完成' }] as const;
const phaseEasing = Easing.bezier(...MOTION_STANDARD_BEZIER);
const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface.base },
    toolbar: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.default },
    tabs: { flex: 1, flexDirection: 'row' },
    tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    tabLabel: { fontSize: 14, color: theme.colors.text.secondary },
    selectedLabel: { color: theme.colors.accent.blue, fontWeight: '600' },
    indicator: { position: 'absolute', left: 0, bottom: 0, height: 2, backgroundColor: theme.colors.accent.blue },
    iconHit: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    search: { marginHorizontal: 16, marginVertical: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.colors.surface.inset, color: theme.colors.text.primary, fontSize: 14 },
    hint: { paddingHorizontal: 16, paddingVertical: 10, color: theme.colors.text.secondary, fontSize: 12 },
    historyTitle: { flex: 1, paddingHorizontal: 16, fontSize: 14, color: theme.colors.text.primary },
    historyLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
    historyLinkText: { color: theme.colors.text.secondary, fontSize: 12 },
}));

/** 三态标签保留短位移动效；减少动态效果时直接定位，不重挂实际列表。 */
function PhoneBrowsePhaseTabs(props: Readonly<{ phase: PhoneBrowsePhase; onChange: (phase: PhoneBrowsePhase) => void }>) {
    const reducedMotion = useReducedMotionPreference();
    const [width, setWidth] = React.useState(0);
    const offset = useSharedValue(0);
    const phaseIndex = PHASES.findIndex((phase) => phase.id === props.phase);
    React.useEffect(() => {
        const nextOffset = width / PHASES.length * phaseIndex;
        offset.value = reducedMotion ? nextOffset : withTiming(nextOffset, { duration: motionTokens.durationMs.fast, easing: phaseEasing });
    }, [offset, phaseIndex, reducedMotion, width]);
    const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
    return <View style={styles.tabs} accessibilityRole="tablist" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {PHASES.map((phase) => <Pressable key={phase.id} testID={`phone-sessions-status:${phase.id}`} accessibilityRole="tab" accessibilityLabel={phase.label}
            accessibilityState={{ selected: phase.id === props.phase }} style={styles.tab} onPress={() => props.onChange(phase.id)}>
            <Text style={[styles.tabLabel, phase.id === props.phase ? styles.selectedLabel : null]}>{phase.label}</Text>
        </Pressable>)}
        <Animated.View pointerEvents="none" style={[styles.indicator, { width: width / PHASES.length }, animatedStyle]} />
    </View>;
}

/** 账号、服务器或明确路由范围变化时重挂，防止旧身份的候选和动作流入新入口。 */
export function PhoneSessionsOverview() {
    const scope = useActiveServerAccountScope();
    const params = useLocalSearchParams<{ machineId?: string; serverId?: string; projectId?: string; sourceKey?: string }>();
    const machineId = typeof params.machineId === 'string' ? params.machineId : undefined;
    if (!scope) return <View style={styles.screen}><Text style={styles.hint}>尚未连接账号</Text></View>;
    if (params.serverId !== undefined && params.serverId !== scope.serverId) {
        return <View style={styles.screen}><Text testID="phone-sessions-unavailable" style={styles.hint}>电脑不属于当前连接，请返回电脑列表重新选择。</Text></View>;
    }
    if (params.machineId !== undefined && !machineId?.trim()) {
        return <View style={styles.screen}><Text testID="phone-sessions-machine-unavailable" style={styles.hint}>电脑范围已失效，请返回电脑列表重新选择。</Text></View>;
    }
    const hasProjectParams = params.projectId !== undefined || params.sourceKey !== undefined;
    if (hasProjectParams && (!machineId || typeof params.projectId !== 'string' || !params.projectId.trim() || typeof params.sourceKey !== 'string' || !params.sourceKey.trim())) {
        return <View style={styles.screen}><Text testID="phone-sessions-project-unavailable" style={styles.hint}>项目范围已失效，请返回电脑列表重新选择。</Text></View>;
    }
    const projectKey = hasProjectParams ? JSON.stringify([params.sourceKey, params.projectId]) : undefined;
    return <ScopedPhoneSessionsOverview key={JSON.stringify([scope.serverId, scope.accountId, machineId, projectKey])} serverId={scope.serverId} accountId={scope.accountId} machineId={machineId} projectKey={projectKey} />;
}

/** 首页统一展示同账号电脑；电脑页带入的明确范围则展示该范围全部真实历史。 */
function ScopedPhoneSessionsOverview(scope: Readonly<{ serverId: string; accountId: string; machineId?: string; projectKey?: string }>) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const machines = useAllMachines();
    const profile = useProfile();
    const settings = useSettings();
    const clockNowMs = useSessionListRuntimeNowMs();
    // 公共时钟负责定时重绘；刚收到的事实以本次渲染时间校验，避免被上次时钟 tick 误判成未来。
    const nowMs = Math.max(clockNowMs, Date.now());
    const [query, setQuery] = React.useState('');
    const [searchOpen, setSearchOpen] = React.useState(false);
    const [phase, setPhase] = React.useState<PhoneBrowsePhase>('running');
    const [snapshots, setSnapshots] = React.useState<Readonly<Record<string, PhoneBrowseSnapshot | undefined>>>({});
    const actionPending = React.useRef(false);
    const openingKeyRef = React.useRef<string | null>(null);
    const [openingKey, setOpeningKey] = React.useState<string | null>(null);
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
        ...scope, sources, snapshots, phase: history ? null : phase, nowMs,
        projectRequired: Boolean(scope.projectKey), project: selectedProject,
    }), [scope.serverId, scope.accountId, scope.projectKey, sources, snapshots, history, phase, nowMs, selectedProject]);

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
        <View style={styles.toolbar}>
            {history ? <Text style={styles.historyTitle} numberOfLines={1}>{selectedProject?.name || '全部历史'}</Text> : <PhoneBrowsePhaseTabs phase={phase} onChange={setPhase} />}
            <Pressable testID="phone-sessions-search-toggle" accessibilityRole="button" accessibilityLabel={searchOpen ? '关闭搜索' : '搜索会话'} accessibilityState={{ expanded: searchOpen }} style={styles.iconHit}
                onPress={() => setSearchOpen((open) => !open)}>
                <Icon name={searchOpen ? 'x' : 'magnifying-glass'} size={18} color={theme.colors.text.primary} />
            </Pressable>
        </View>
        {searchOpen ? <TextInput testID="phone-sessions-search" accessibilityLabel="搜索会话" placeholder="搜索标题或项目" placeholderTextColor={theme.colors.input.placeholder} value={query} onChangeText={setQuery} style={styles.search} /> : null}
        {machines.length === 0 ? <Text style={styles.hint}>还没有连接的电脑，请在电脑端登录同一账号。</Text> : null}
        {scope.machineId && visibleMachines.length === 0 ? <Text testID="phone-sessions-machine-unavailable" style={styles.hint}>当前账号下没有所选电脑，请返回重新选择。</Text> : null}
        {scope.projectKey && projectState.loading && !projectState.projects ? <Text style={styles.hint}>{t('codexTopProjects.loading')}</Text> : null}
        {projectUnavailable ? <Text testID="phone-sessions-project-unavailable" style={styles.hint}>{t('codexTopProjects.missing')}</Text> : null}
        {scope.projectKey && selectedComputer && !isMachineOnline(selectedComputer, nowMs) ? <Text style={styles.hint}>{t('codexTopProjects.offline')}</Text> : null}
        {!history && aggregate.hasUnclassified ? <Pressable testID="phone-sessions-history-link" accessibilityRole="button" style={styles.historyLink} onPress={() => router.push('/settings/machines')}>
            <Text style={styles.historyLinkText}>部分会话未列入分类，查看历史</Text>
        </Pressable> : null}
        {sources.map((source) => <PhoneBrowseSourceOwner key={source.key} source={source} serverId={scope.serverId} searchQuery={searchOpen ? query : ''} onSnapshot={publishSnapshot} />)}
        <PhoneDirectBrowseCandidatesList rows={aggregate.rows} nowMs={nowMs} history={history}
            openingKey={openingKey} onSelectRow={openRow}
            loading={aggregate.loading || Boolean(scope.projectKey && projectState.loading)} loadingMore={aggregate.loadingMore}
            incomplete={aggregate.incomplete || Boolean(projectState.error)} hasMore={aggregate.hasMore} hasSearch={searchOpen && Boolean(query.trim())}
            canLoadMore={aggregate.loadMoreSources.length > 0} canRefresh={aggregate.refreshSources.length > 0 || Boolean(scope.projectKey && !projectState.loading)}
            onRefresh={() => { void refresh(); }} onLoadMore={() => { void loadMore(); }} />
    </View>;
}
