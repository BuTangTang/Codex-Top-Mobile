import { CodexLifecycleV1Schema, type CodexLifecycleV1, type DirectSessionsSource } from '@happier-dev/protocol';
import { resolvePathRelativeToRoot } from '@/utils/path/resolvePathRelativeToRoot';
import { readDirectBrowseCandidatePath } from './buildDirectBrowseCandidatePresentation';
import { buildPhoneSessionIdentity } from './phoneSessionIdentity';
import { resolveDirectBrowseLinkEnsureRequestExtras } from './resolveDirectBrowseSourceOptions';
import { shouldUseCandidateSource } from './shouldUseCandidateSource';
import type { DirectBrowseCandidate } from './useDirectBrowseCandidates';

export type PhoneBrowsePhase = 'running' | 'needs_input' | 'completed';
export type PhoneBrowseSource = Readonly<{
    key: string;
    machineId: string;
    machineLabel: string;
    sourceKey: string;
    source: DirectSessionsSource;
    online: boolean;
}>;
export type PhoneBrowseSnapshot = Readonly<{
    candidates: readonly DirectBrowseCandidate[];
    nextCursor: string | null;
    loading: boolean;
    loadingMore: boolean;
    searchAugmenting: boolean;
    searchIncomplete: boolean;
    refreshRequired: boolean;
    error: string | null;
    linkingSessionId: string | null;
    refresh: () => Promise<void>;
    loadMore: () => Promise<void>;
    selectCandidate: (candidate: DirectBrowseCandidate) => Promise<void>;
}>;
export type PhoneBrowseRow = Readonly<{
    key: string;
    ownerKey: string;
    candidate: DirectBrowseCandidate;
    sourceLabel: string;
    lifecycle: CodexLifecycleV1;
    timeMs: number | null;
    snapshot: PhoneBrowseSnapshot;
}>;
type PhoneBrowseProject = Readonly<{ sourceKey: string; name: string; rootPaths: readonly string[]; available: boolean }>;
const LIFECYCLE_MAX_AGE_MS = 900_000;

/** 只用本进程单调时钟计龄，保守包含请求等待；无有效单调观测时不能退回墙钟续龄。 */
function readPhoneCandidateObservation(candidate: DirectBrowseCandidate, monotonicNowMs: number) {
    const observation = candidate.listObservation;
    // 原生后台边界使整批旧观测失效，即使 React 尚未提交或单调时钟在深睡中停止。
    if (observation?.scope && !observation.scope.isCurrent()) return null;
    const requested = observation?.requestedMonotonicMs;
    const received = observation?.receivedMonotonicMs;
    if (!Number.isFinite(monotonicNowMs) || typeof requested !== 'number' || typeof received !== 'number'
        || !Number.isFinite(requested) || !Number.isFinite(received)
        || requested < 0 || received < requested || monotonicNowMs < received) return null;
    return { elapsedMs: monotonicNowMs - requested };
}

/** 电脑事件仅和同次检查时间相减；缓存过期用手机单调经过时长，不能比较两端墙钟。 */
export function readPhoneCandidateLifecycle(candidate: DirectBrowseCandidate, online: boolean, nowMs: number,
    monotonicNowMs = globalThis.performance?.now?.() ?? NaN): CodexLifecycleV1 {
    const parsed = CodexLifecycleV1Schema.safeParse(candidate.details?.codexLifecycle);
    const unknown: CodexLifecycleV1 = { v: 1, state: 'unknown', eventAtMs: null, checkedAtMs: nowMs };
    if (!online || !parsed.success) return unknown;
    const observation = readPhoneCandidateObservation(candidate, monotonicNowMs);
    if (!observation || observation.elapsedMs > LIFECYCLE_MAX_AGE_MS) return unknown;
    const fact = parsed.data;
    // 协议已校验 eventAt <= checkedAt；running 还需要检查当时年龄加本机缓存年龄。
    if (fact.state === 'running' && (fact.eventAtMs === null
        || fact.checkedAtMs - fact.eventAtMs + observation.elapsedMs > LIFECYCLE_MAX_AGE_MS)) return unknown;
    return fact;
}

/** 用同一候选的 LIST 检查时间换算更新时间；无参照时保留有效原值，不误判电脑领先为未来。 */
function readPhoneCandidateUpdatedAt(candidate: DirectBrowseCandidate): number | null {
    if (!Number.isFinite(candidate.updatedAtMs) || candidate.updatedAtMs <= 0) return null;
    const parsed = CodexLifecycleV1Schema.safeParse(candidate.details?.codexLifecycle);
    const observation = candidate.listObservation;
    if (!parsed.success || !observation || !Number.isFinite(observation.requestedAtMs)
        || !Number.isFinite(observation.receivedAtMs) || observation.requestedAtMs < 0
        || observation.receivedAtMs < observation.requestedAtMs) return candidate.updatedAtMs;
    if (candidate.updatedAtMs > parsed.data.checkedAtMs) return null;
    return observation.requestedAtMs + candidate.updatedAtMs - parsed.data.checkedAtMs;
}

/** 项目范围只来自已验证的电脑项目；缺失或失效项目不退回整台电脑。 */
function belongsToPhoneProject(candidate: DirectBrowseCandidate, source: PhoneBrowseSource, project: PhoneBrowseProject): boolean {
    const path = readDirectBrowseCandidatePath(candidate.details);
    return project.available && source.sourceKey === project.sourceKey && Boolean(path)
        && project.rootPaths.some((root) => resolvePathRelativeToRoot({ path: path!, root }) !== null);
}

/** 多个查询 owner 的现有页投影成一个列表；保留实际来源动作和游标，不复制刷新分页机制。 */
export function aggregatePhoneBrowseSources(input: Readonly<{
    serverId: string;
    accountId: string;
    sources: readonly PhoneBrowseSource[];
    snapshots: Readonly<Record<string, PhoneBrowseSnapshot | undefined>>;
    phase: PhoneBrowsePhase | null;
    nowMs: number;
    projectRequired?: boolean;
    project?: PhoneBrowseProject | null;
}>) {
    // 同一次聚合使用同一个单调时刻，所有行跨越过期边界的依据一致。
    const monotonicNowMs = globalThis.performance?.now?.() ?? NaN;
    const rowsByIdentity = new Map<string, PhoneBrowseRow>();
    const loadMoreSources: PhoneBrowseSnapshot[] = [];
    const refreshSources: PhoneBrowseSnapshot[] = [];
    let loading = false;
    let loadingMore = false;
    let hasMore = false;
    let incomplete = false;
    let hasUnclassified = false;
    for (const source of input.sources) {
        const snapshot = input.snapshots[source.key];
        if (!source.online) hasUnclassified = true;
        if (!snapshot) { loading = true; continue; }
        loading ||= snapshot.loading || snapshot.searchAugmenting;
        loadingMore ||= snapshot.loadingMore;
        hasMore ||= Boolean(snapshot.nextCursor);
        incomplete ||= Boolean(snapshot.error) || snapshot.refreshRequired || snapshot.searchIncomplete || !source.online;
        if (snapshot.error || snapshot.refreshRequired) hasUnclassified = true;
        if (!snapshot.loading && !snapshot.loadingMore && !snapshot.searchAugmenting) {
            refreshSources.push(snapshot);
            if (snapshot.nextCursor && !snapshot.refreshRequired) loadMoreSources.push(snapshot);
        }
        for (const candidate of snapshot.candidates) {
            if (input.projectRequired && !input.project) continue;
            if (input.project && !belongsToPhoneProject(candidate, source, input.project)) continue;
            const lifecycle = readPhoneCandidateLifecycle(candidate, source.online, input.nowMs, monotonicNowMs);
            if (lifecycle.state === 'unknown' || lifecycle.state === 'failed' || lifecycle.state === 'cancelled') hasUnclassified = true;
            if (input.phase && lifecycle.state !== input.phase) continue;
            const extras = resolveDirectBrowseLinkEnsureRequestExtras({ providerId: 'codex', source: source.source, candidate });
            const candidateSource = extras.source as DirectSessionsSource | undefined;
            const effectiveSource = shouldUseCandidateSource(source.source, candidateSource) ? candidateSource! : source.source;
            const key = buildPhoneSessionIdentity({ ...input, machineId: source.machineId, source: effectiveSource, remoteSessionId: candidate.remoteSessionId });
            const updatedAtMs = readPhoneCandidateUpdatedAt(candidate);
            const row: PhoneBrowseRow = {
                key, ownerKey: source.key, candidate, snapshot, lifecycle,
                sourceLabel: input.project?.name ? `${source.machineLabel} · ${input.project.name}` : source.machineLabel,
                timeMs: updatedAtMs,
            };
            const previous = rowsByIdentity.get(key);
            // 重叠来源优先采用最新更新的候选；相同更新时间才比较事实检查时间。
            if (!previous || (row.timeMs ?? 0) > (previous.timeMs ?? 0)
                || (row.timeMs === previous.timeMs && lifecycle.checkedAtMs > previous.lifecycle.checkedAtMs)) rowsByIdentity.set(key, row);
        }
    }
    // 时间只用于排序及显示，完全不参与状态分类；相同时间使用完整身份稳定排序。
    const rows = [...rowsByIdentity.values()].sort((left, right) => (right.timeMs ?? 0) - (left.timeMs ?? 0) || left.key.localeCompare(right.key));
    return { rows, loading, loadingMore, hasMore, incomplete, hasUnclassified, refreshSources, loadMoreSources };
}
