import * as React from 'react';
import { AppState, Platform, useWindowDimensions } from 'react-native';
import { isRunningOnMac } from '@/utils/platform/platform';
import { isMobileLayoutWidth } from '@/components/sessions/layout/isMobileLayoutWidth';
import { useAllMachines } from '@/sync/domains/state/storage';
import { useActiveServerAccountScope, useIsDataReady, useMachineDisplayById, useProfile, useSettings, useSocketStatus } from '@/sync/store/hooks';
import { loadDirectSessionTranscriptWarmCacheIndex } from '@/sync/domains/state/warmCachePersistence';
import { readDirectSessionLink } from '@/sync/domains/session/directSessions/readDirectSessionLink';
import { useSessionListRuntimeNowMs, useSessionListRuntimeWake } from '@/hooks/session/sessionListRuntimeClock';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';
import { stableJsonStringify } from '@/utils/json/stableJsonStringify';
import { ACCOUNT_DISPLAY_SETTING_DEFINITIONS } from '@/sync/domains/settings/registry/account/accountDisplaySettingDefinitions';
import { resolveDirectBrowseSourceOptions, resolveDirectBrowseLinkEnsureRequestExtras } from './resolveDirectBrowseSourceOptions';
import { shouldUseCandidateSource } from './shouldUseCandidateSource';
import { readDirectBrowseCandidatePath } from './buildDirectBrowseCandidatePresentation';
import type { DirectSessionLinkEnsureRequest, DirectSessionsSource } from '@happier-dev/protocol';
import { PhoneBrowseSourceOwner } from './PhoneBrowseSourceOwner';
import { aggregatePhoneBrowseSources, type PhoneBrowseSnapshot, type PhoneBrowseSource } from './phoneBrowseAggregation';

type AccountScope = Readonly<{ serverId: string; accountId: string; machineId?: string }>;
type RecentValue = Readonly<{ sources: PhoneBrowseSource[]; snapshots: Readonly<Record<string, PhoneBrowseSnapshot | undefined>> }>;
const RecentContext = React.createContext<RecentValue | null>(null);

/** 首页读取全局同一份候选；历史和搜索仍由明确范围的按需owner负责。 */
export function usePhoneRecentSessions() { return React.useContext(RecentContext); }

/** 共用既有机器和离线显示来源解析，账号范围不跨首页与全局runtime分裂。 */
export function usePhoneBrowseSources(scope: AccountScope, nowMs: number) {
    const machines = useAllMachines();
    const machineDisplays = useMachineDisplayById();
    const dataReady = useIsDataReady();
    const profile = useProfile();
    const settings = useSettings();
    const socket = useSocketStatus();
    const visibleMachines = React.useMemo(() => scope.machineId ? machines.filter((machine) => machine.id === scope.machineId) : machines, [machines, scope.machineId]);
    const sourceOptions = React.useMemo(() => resolveDirectBrowseSourceOptions({ providerId: 'codex', profile, settings }), [profile, settings]);
    const sources = React.useMemo<PhoneBrowseSource[]>(() => {
        const onlineOwned = visibleMachines.flatMap((machine) => sourceOptions.map((option) => ({
        key: stableJsonStringify([scope.serverId, scope.accountId, machine.id, option.key, option.source]),
        machineId: machine.id, machineLabel: getMachineDisplayName(machine) ?? '电脑',
        sourceKey: option.key, source: option.source, online: isMachineOnline(machine, nowMs),
        })));
        // 冷开离线只借用既有显示缓存作为入口，不创建机器实体或沿用上次在线事实。
        const cachedMachineIds = new Set(Object.values((socket.status !== 'connected' || !dataReady) && visibleMachines.length === 0
            ? loadDirectSessionTranscriptWarmCacheIndex(scope.serverId, scope.accountId) : {})
            .map((entry) => readDirectSessionLink(entry.session.metadata)?.machineId).filter((id): id is string => Boolean(id)));
        for (const id of cachedMachineIds) {
            const display = machineDisplays[id];
            if (!display || display.revokedAt || display.replacedByMachineId || visibleMachines.some((machine) => machine.id === id) || (scope.machineId && scope.machineId !== id)) continue;
            for (const option of sourceOptions) onlineOwned.push({
                key: stableJsonStringify([scope.serverId, scope.accountId, id, option.key, option.source]),
                machineId: id, machineLabel: getMachineDisplayName(display) ?? '电脑', sourceKey: option.key, source: option.source, online: false,
            });
        }
        return onlineOwned;
    }, [visibleMachines, machineDisplays, dataReady, sourceOptions, scope.serverId, scope.accountId, scope.machineId, socket.status, nowMs]);
    return { sources, visibleMachines, machines, machineDisplays };
}

/** 原生手机的全部前台页面共用最近发现，不在网页或桌面挂接额外扫描。 */
export function PhoneRecentSessionsProvider({ children }: React.PropsWithChildren) {
    const scope = useActiveServerAccountScope();
    const { width } = useWindowDimensions();
    if (!scope || Platform.OS === 'web' || isRunningOnMac() || !isMobileLayoutWidth(width)) return <>{children}</>;
    return <ScopedPhoneRecentSessionsProvider key={JSON.stringify([scope.serverId, scope.accountId])} scope={scope}>{children}</ScopedPhoneRecentSessionsProvider>;
}

/** 一个账号代次只保留一组来源owner；后台、断线和卸载立即作废旧异步准入。 */
function ScopedPhoneRecentSessionsProvider({ scope, children }: React.PropsWithChildren<{ scope: AccountScope }>) {
    const socket = useSocketStatus();
    const settings = useSettings();
    const [appActive, setAppActive] = React.useState(AppState.currentState === 'active');
    const [generation, setGeneration] = React.useState(0);
    const generationRef = React.useRef(0);
    const liveRef = React.useRef(true);
    const currentScopeRef = React.useRef<object | null>(null);
    const enabled = appActive && socket.status === 'connected';
    const observationScope = React.useMemo(() => {
        const token = {};
        return { token, isCurrent: () => liveRef.current && enabled && generationRef.current === generation && currentScopeRef.current === token };
    }, [enabled, generation]);
    currentScopeRef.current = observationScope.token;
    React.useEffect(() => {
        liveRef.current = true;
        let active = AppState.currentState === 'active';
        const subscription = AppState.addEventListener('change', (state) => {
            const next = state === 'active';
            if (next !== active) { active = next; generationRef.current++; setGeneration(generationRef.current); }
            setAppActive(next);
        });
        return () => { liveRef.current = false; currentScopeRef.current = null; subscription.remove(); };
    }, []);
    useSessionListRuntimeNowMs(appActive);
    const nowMs = Date.now();
    const { sources } = usePhoneBrowseSources(scope, nowMs);
    const recentLimit = settings.phoneRecentSessionLimit ?? ACCOUNT_DISPLAY_SETTING_DEFINITIONS.phoneRecentSessionLimit.default;
    const [snapshots, setSnapshots] = React.useState<RecentValue['snapshots']>({});
    /** 只保留原owner发布的快照，卸载删除，不额外维护候选缓存。 */
    const publish = React.useCallback((key: string, value: PhoneBrowseSnapshot | null) => setSnapshots((current) => {
        if (current[key] === (value ?? undefined)) return current;
        if (value) return { ...current, [key]: value };
        const next = { ...current }; delete next[key]; return next;
    }), []);
    const aggregate = React.useMemo(() => aggregatePhoneBrowseSources({ ...scope, sources, snapshots, phase: null, nowMs }), [scope.serverId, scope.accountId, sources, snapshots, nowMs]);
    useSessionListRuntimeWake(aggregate.nextLifecycleWakeAtMs, appActive);
    React.useEffect(() => {
        if (!observationScope.isCurrent() || aggregate.loading) return;
        // 所有来源聚合后统一限额，不能每台电脑各预取50条；能力缺失绝不向旧端发送可被忽略的意图。
        const requests = aggregate.rows.slice(0, recentLimit).flatMap((row) => {
            const source = sources.find((item) => item.key === row.ownerKey);
            if (!source?.online || row.snapshot.canLinkWithoutOpening !== true) return [];
            const extras = resolveDirectBrowseLinkEnsureRequestExtras({ providerId: 'codex', source: source.source, candidate: row.candidate });
            const candidateSource = extras.source as DirectSessionsSource | undefined;
            const link: DirectSessionLinkEnsureRequest = {
                machineId: source.machineId, providerId: 'codex', remoteSessionId: row.candidate.remoteSessionId,
                ...(row.candidate.title ? { titleHint: row.candidate.title } : {}),
                ...(readDirectBrowseCandidatePath(row.candidate.details) ? { directoryHint: readDirectBrowseCandidatePath(row.candidate.details)! } : {}),
                ...extras, source: shouldUseCandidateSource(source.source, candidateSource) ? candidateSource! : source.source, openExisting: false,
            };
            // 无版本候选沿真实 LIST 轮次触发；仅转交原对象，重绘不制造新版本。
            return [{ link, transcriptVersion: row.candidate.transcriptVersion, discoveryObservation: row.candidate.listObservation, sourceUpdatedAtMs: row.timeMs }];
        });
        // 空集合也交回同步owner，立即撤销已离线、移除或失去能力来源的旧预取。
        // 延迟载入现成同步owner，版本账本、并发、增量落盘与失效守卫全部复用该owner。
        void import('@/sync/sync').then(({ sync }) => {
            if (observationScope.isCurrent()) return sync.prefetchPhoneRecentDirectSessions({ ...scope, isCurrent: observationScope.isCurrent, requests });
        }).catch(() => { /* 网络失败由原同步owner重试，不能改写列表事实或弹出导航。 */ });
    }, [aggregate, sources, recentLimit, observationScope, scope.serverId, scope.accountId]);
    const notOpening = React.useCallback(() => false, []);
    const value = React.useMemo(() => ({ sources, snapshots }), [sources, snapshots]);
    return <RecentContext.Provider value={value}>
        {sources.map((source) => <PhoneBrowseSourceOwner key={source.key} source={source} serverId={scope.serverId} searchQuery=""
            requestLimit={recentLimit} discoveryEnabled={enabled && source.online} observationScope={observationScope}
            actionPending={false} isActionPending={notOpening} onSnapshot={publish} />)}
        {children}
    </RecentContext.Provider>;
}
