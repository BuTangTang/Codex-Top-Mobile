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

/** 列表只接受已验证的桌面生命周期；离线、过期或缺失绝不以活跃时间补成运行或完成。 */
export function readPhoneCandidateLifecycle(candidate: DirectBrowseCandidate, online: boolean, nowMs: number): CodexLifecycleV1 {
    const parsed = CodexLifecycleV1Schema.safeParse(candidate.details?.codexLifecycle);
    const unknown: CodexLifecycleV1 = { v: 1, state: 'unknown', eventAtMs: null, checkedAtMs: nowMs };
    if (!online || !parsed.success) return unknown;
    const fact = parsed.data;
    if (fact.checkedAtMs > nowMs || nowMs - fact.checkedAtMs > LIFECYCLE_MAX_AGE_MS) return unknown;
    if (fact.eventAtMs !== null && fact.eventAtMs > nowMs) return unknown;
    if (fact.state === 'running' && (fact.eventAtMs === null || nowMs - fact.eventAtMs > LIFECYCLE_MAX_AGE_MS)) return unknown;
    return fact;
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
            const lifecycle = readPhoneCandidateLifecycle(candidate, source.online, input.nowMs);
            if (lifecycle.state === 'unknown' || lifecycle.state === 'failed' || lifecycle.state === 'cancelled') hasUnclassified = true;
            if (input.phase && lifecycle.state !== input.phase) continue;
            const extras = resolveDirectBrowseLinkEnsureRequestExtras({ providerId: 'codex', source: source.source, candidate });
            const candidateSource = extras.source as DirectSessionsSource | undefined;
            const effectiveSource = shouldUseCandidateSource(source.source, candidateSource) ? candidateSource! : source.source;
            const key = buildPhoneSessionIdentity({ ...input, machineId: source.machineId, source: effectiveSource, remoteSessionId: candidate.remoteSessionId });
            const updatedAtMs = Number.isFinite(candidate.updatedAtMs) && candidate.updatedAtMs > 0 && candidate.updatedAtMs <= input.nowMs ? candidate.updatedAtMs : null;
            const row: PhoneBrowseRow = {
                key, ownerKey: source.key, candidate, snapshot, lifecycle,
                sourceLabel: input.project?.name ? `${source.machineLabel} · ${input.project.name}` : source.machineLabel,
                timeMs: lifecycle.eventAtMs ?? updatedAtMs,
            };
            const previous = rowsByIdentity.get(key);
            if (!previous || lifecycle.checkedAtMs > previous.lifecycle.checkedAtMs) rowsByIdentity.set(key, row);
        }
    }
    // 时间只用于排序及显示，完全不参与状态分类；相同时间使用完整身份稳定排序。
    const rows = [...rowsByIdentity.values()].sort((left, right) => (right.timeMs ?? 0) - (left.timeMs ?? 0) || left.key.localeCompare(right.key));
    return { rows, loading, loadingMore, hasMore, incomplete, hasUnclassified, refreshSources, loadMoreSources };
}
