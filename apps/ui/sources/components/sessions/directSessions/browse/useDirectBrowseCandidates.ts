import * as React from 'react';
import type { DirectSessionActivityV1, DirectSessionsProviderId, DirectSessionsSource } from '@happier-dev/protocol';

import { machineDirectSessionsCandidatesList } from '@/sync/ops/machineDirectSessions';
import { t } from '@/text';
import { stableJsonStringify } from '@/utils/json/stableJsonStringify';

/** 一个前台观测范围；原生 AppState 变化后可在 React 提交前同步拒绝旧请求。 */
export type DirectBrowseObservationScope = Readonly<{ isCurrent: () => boolean }>;

export type DirectBrowseCandidate = Readonly<{
    remoteSessionId: string;
    title?: string;
    updatedAtMs: number;
    activity?: DirectSessionActivityV1;
    details?: Record<string, unknown>;
    // 仅由当前 LIST owner 记录手机墙钟和单调时间，不写回协议或持久化；随原页保留。
    listObservation?: Readonly<{
        requestedAtMs: number;
        receivedAtMs: number;
        requestedMonotonicMs?: number;
        receivedMonotonicMs?: number;
        requestSequence?: number;
        scope?: DirectBrowseObservationScope;
    }>;
}>;

const CANDIDATES_PAGE_LIMIT = 50;

// 最近列表以 30 秒低频发现新对话；每轮完成后才计时，慢请求不会被周期重启。
const DISCOVERY_INTERVAL_MS = 30_000;
type CandidatePage = Readonly<{ candidates: readonly DirectBrowseCandidate[]; nextCursor: string | null; incomplete: boolean }>;

function hasCandidateTitle(candidate: DirectBrowseCandidate): boolean {
    return typeof candidate.title === 'string' && candidate.title.trim().length > 0;
}

function mergeCandidateDetails(
    current: DirectBrowseCandidate['details'],
    next: DirectBrowseCandidate['details'],
): DirectBrowseCandidate['details'] {
    if (!current) return next;
    if (!next) return current;
    return { ...current, ...next };
}

/** 重叠页采用最近一次本机观测；生命周期和观测时间一起替换，不能给旧事实续龄。 */
function mergeDirectBrowseCandidate(current: DirectBrowseCandidate, next: DirectBrowseCandidate): DirectBrowseCandidate {
    // 顺序只属于本 owner，不受同毫秒请求或手机墙上时钟回拨影响。
    const keepCurrent = (current.listObservation?.requestSequence ?? 0) > (next.listObservation?.requestSequence ?? 0);
    const latest = keepCurrent ? current : next;
    const earlier = keepCurrent ? next : current;
    const details = mergeCandidateDetails(earlier.details, latest.details);
    return {
        remoteSessionId: current.remoteSessionId,
        title: hasCandidateTitle(latest) ? latest.title : earlier.title,
        updatedAtMs: latest.updatedAtMs,
        activity: latest.activity ?? earlier.activity,
        // 新响应未提供生命周期时必须未知，不能继承旧事实再贴新接收时间。
        details: details ? { ...details, codexLifecycle: latest.details?.codexLifecycle } : undefined,
        listObservation: latest.listObservation,
    };
}

function compareDirectBrowseCandidates(a: DirectBrowseCandidate, b: DirectBrowseCandidate): number {
    return b.updatedAtMs - a.updatedAtMs || a.remoteSessionId.localeCompare(b.remoteSessionId);
}

function mergeDirectBrowseCandidates(
    current: readonly DirectBrowseCandidate[],
    next: readonly DirectBrowseCandidate[],
    mode: 'append' | 'merge',
): readonly DirectBrowseCandidate[] {
    // 请求代次已隔离机器、提供方与来源；在当前来源内沿用 remoteSessionId 合并身份。
    const merged = new Map<string, DirectBrowseCandidate>();
    for (const candidate of current) {
        merged.set(candidate.remoteSessionId, candidate);
    }
    for (const candidate of next) {
        const existing = merged.get(candidate.remoteSessionId);
        merged.set(candidate.remoteSessionId, existing ? mergeDirectBrowseCandidate(existing, candidate) : candidate);
    }
    const candidates = Array.from(merged.values());
    // 翻页只补新行并更新重叠行，避免更新时间变化把正在阅读的行重新排序。
    return mode === 'append' ? candidates : candidates.sort(compareDirectBrowseCandidates);
}

/** 在既有候选 owner 内维护有限分页窗口；自动、手动刷新和翻页共享单飞。 */
export function useDirectBrowseCandidates(params: Readonly<{
    machineId: string | null;
    serverId?: string | null;
    accountId?: string | null;
    providerId: DirectSessionsProviderId | null;
    source: DirectSessionsSource | null;
    searchTerm?: string;
    requestLimit?: number;
    autoRefreshEnabled?: boolean;
    observationScope?: DirectBrowseObservationScope;
    actionPending?: boolean;
    isActionPending?: () => boolean;
}>) {
    const { machineId, providerId, source, serverId } = params;
    const query = params.searchTerm?.trim() ?? '';
    const requestLimit = params.requestLimit ?? CANDIDATES_PAGE_LIMIT;
    // 数量改变同样废弃旧分页与回包；电脑和项目历史不传偏好，仍按原来的每页 50 条读取。
    const scopeKey = stableJsonStringify([serverId, params.accountId, machineId, providerId, source, query, requestLimit]);
    const scopeRef = React.useRef(scopeKey);
    scopeRef.current = scopeKey;
    const controlsRef = React.useRef(params);
    controlsRef.current = params;
    const [candidates, setCandidates] = React.useState<readonly DirectBrowseCandidate[]>([]);
    const [nextCursor, setNextCursor] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [searchAugmenting, setSearchAugmenting] = React.useState(false);
    const [searchIncomplete, setSearchIncomplete] = React.useState(false);
    const [refreshRequired, setRefreshRequired] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [canDeleteCandidates, setCanDeleteCandidates] = React.useState(false);
    const [settledVersion, setSettledVersion] = React.useState(0);
    const pagesRef = React.useRef<readonly CandidatePage[]>([]);
    const refreshRequiredRef = React.useRef(false);
    const generationRef = React.useRef(0);
    const observationSequenceRef = React.useRef(0);
    const appliedObservationScopeRef = React.useRef(params.observationScope);
    const flightRef = React.useRef<{ promise: Promise<void> } | null>(null);

    /** 同一前台范围请求共享 Promise；身份切换、后台边界和成功删除作废旧回包。 */
    const loadCandidates = React.useCallback((opts?: Readonly<{ append?: boolean; automatic?: boolean }>): Promise<void> => {
        const controls = controlsRef.current;
        if (!machineId || !providerId || !source || scopeRef.current !== scopeKey) return Promise.resolve();
        if (controls.observationScope && !controls.observationScope.isCurrent()) return Promise.resolve();
        if (controls.actionPending || controls.isActionPending?.()) return Promise.resolve();
        if (opts?.automatic && controls.autoRefreshEnabled !== true) return Promise.resolve();
        if (flightRef.current) return flightRef.current.promise;
        const oldPages = pagesRef.current;
        const append = opts?.append === true;
        const cursor = oldPages.at(-1)?.nextCursor;
        if (append && (!cursor || refreshRequiredRef.current)) return Promise.resolve();
        const generation = generationRef.current;
        const observationScope = controls.observationScope;
        const flight = { promise: Promise.resolve() };
        flightRef.current = flight;
        if (append) setLoadingMore(true);
        else { setLoading(true); setError(null); }

        /** 等待后检查身份、数据代次及原生前台边界，React 尚未重渲染也不能接收旧回包。 */
        const isCurrent = () => scopeRef.current === scopeKey && generationRef.current === generation
            && (!observationScope || observationScope.isCurrent());
        /** 多页重建和完整搜索的后续请求也遵守前台及动作门禁。 */
        const request = async (pageCursor?: string | null, searchMode?: 'fast' | 'full') => {
            const latest = controlsRef.current;
            if (!isCurrent() || latest.actionPending || latest.isActionPending?.()
                || (opts?.automatic && latest.autoRefreshEnabled !== true)) return null;
            const input = {
                machineId, providerId, source, limit: requestLimit,
                ...(pageCursor ? { cursor: pageCursor } : {}),
                ...(query ? { searchTerm: query } : {}),
                ...(searchMode ? { searchMode } : {}),
            };
            const requestedAtMs = Date.now();
            // RN/Hermes 的 performance.now 来自 steady_clock；缺失时不降级为可回拨的墙钟。
            const requestedMonotonicMs = globalThis.performance?.now?.() ?? NaN;
            const requestSequence = ++observationSequenceRef.current;
            const result = await (serverId ? machineDirectSessionsCandidatesList(input, { serverId }) : machineDirectSessionsCandidatesList(input));
            const receivedAtMs = Date.now();
            const receivedMonotonicMs = globalThis.performance?.now?.() ?? NaN;
            if (!result.ok) return result;
            // 每次实际 RPC 有独立观测时间；重建窗口和复用深页均不重新盖时间戳。
            const listObservation = { requestedAtMs, receivedAtMs, requestedMonotonicMs, receivedMonotonicMs, requestSequence, scope: observationScope };
            return { ...result, candidates: result.candidates.map((candidate) => ({ ...candidate, listObservation })) };
        };
        /** 页面失败保留已发布事实与浏览范围，继续使用既有错误或游标不完整提示。 */
        const readPage = (result: Awaited<ReturnType<typeof request>>, augmentation = false): CandidatePage | null => {
            if (!isCurrent() || !result) return null;
            if (!result.ok) {
                if (result.refreshRequired) {
                    refreshRequiredRef.current = true;
                    setRefreshRequired(true);
                    setError(null);
                } else if (!augmentation) setError(result.error);
                return null;
            }
            if (augmentation && result.searchIncomplete && result.candidates.length === 0) return null;
            return { candidates: result.candidates, nextCursor: result.nextCursor ?? null, incomplete: result.searchIncomplete === true };
        };
        /** 发布同一 owner 的分页投影；等值行和数组保持引用，不单独缓存另一套列表。 */
        const publishCandidates = (pages: readonly CandidatePage[]) => {
            const items = pages.reduce<readonly DirectBrowseCandidate[]>((all, page) => mergeDirectBrowseCandidates(all, page.candidates, 'append'), []);
            setCandidates((current) => {
                const byId = new Map(current.map((candidate) => [candidate.remoteSessionId, candidate]));
                const reconciled = items.map((candidate) => {
                    const previous = byId.get(candidate.remoteSessionId);
                    return previous && stableJsonStringify(previous) === stableJsonStringify(candidate) ? previous : candidate;
                });
                return current.length === reconciled.length && current.every((item, index) => item === reconciled[index]) ? current : reconciled;
            });
        };
        /** 重建前及时替换已显示行的首屏事实；保留原页边界和键顺序，未重读行不能冒充当前状态。 */
        const publishFirstPageFacts = (first: CandidatePage) => {
            if (!isCurrent()) return;
            const observed = new Map(first.candidates.map((candidate) => [candidate.remoteSessionId, candidate]));
            const retainedPages = pagesRef.current.map((page) => ({ ...page, candidates: page.candidates.map((candidate) => {
                const latest = observed.get(candidate.remoteSessionId);
                if (latest) return mergeDirectBrowseCandidate(candidate, latest);
                if (candidate.details?.codexLifecycle === undefined) return candidate;
                // 只撤销生命周期，不给保留行盖本次观测时间；标题、动作和已浏览范围保持。
                return { ...candidate, details: { ...candidate.details, codexLifecycle: undefined } };
            }) }));
            pagesRef.current = retainedPages;
            publishCandidates(retainedPages);
            // 旧游标只用于保留显示位置，完整重建成功前禁止沿它继续翻页。
            refreshRequiredRef.current = true;
            setRefreshRequired(true);
        };
        /** 已验证且首游标未变时复用深页；失效窗口必须按原加载页数重新核验，不能因游标回到旧值跳过。 */
        const rebuildWindow = async (first: CandidatePage): Promise<readonly CandidatePage[] | null> => {
            if (oldPages.length > 1 && oldPages[0]?.nextCursor === first.nextCursor && !refreshRequiredRef.current) return [first, ...oldPages.slice(1)];
            if (oldPages.length > 1 && first.nextCursor) publishFirstPageFacts(first);
            const pages = [first];
            const seen = new Set<string>();
            while (pages.length < oldPages.length && pages.at(-1)?.nextCursor) {
                const next = pages.at(-1)!.nextCursor!;
                seen.add(next);
                const page = readPage(await request(next));
                if (!page) return null;
                if (page.nextCursor && seen.has(page.nextCursor)) {
                    refreshRequiredRef.current = true;
                    setRefreshRequired(true);
                    return null;
                }
                pages.push(page);
            }
            return pages;
        };
        /** 完整窗口通过后才替换页边界与成员，并解除旧游标门禁。 */
        const commitPages = (pages: readonly CandidatePage[], result: Awaited<ReturnType<typeof request>>) => {
            if (!isCurrent() || !result?.ok) return;
            pagesRef.current = pages;
            publishCandidates(pages);
            setNextCursor(pages.at(-1)?.nextCursor ?? null);
            setSearchIncomplete(pages.some((page) => page.incomplete));
            refreshRequiredRef.current = false;
            setRefreshRequired(false);
            setCanDeleteCandidates(result.capabilities?.deleteCandidate === true);
            setError(null);
        };
        /** 快搜仍先展示可用结果；自动恢复只做快搜，周期搜索不会扫描完整历史。 */
        const run = async () => {
            try {
                const fastSearch = !append && Boolean(query);
                const result = await request(append ? cursor : undefined, fastSearch ? 'fast' : undefined);
                const first = readPage(result);
                if (!first) return;
                // 前台恢复的快搜覆盖有限，不能用其缺失项降级先前完整搜索的窗口和游标。
                if (opts?.automatic && fastSearch && oldPages.length > 0 && first.incomplete) {
                    setSearchIncomplete(true);
                    return;
                }
                const pages = append ? [...oldPages, first] : await rebuildWindow(first);
                if (!pages || !isCurrent()) return;
                commitPages(pages, result);
                if (!fastSearch || !first.incomplete || (opts?.automatic && oldPages.length > 0)) return;
                setLoading(false);
                setSearchAugmenting(true);
                try {
                    const fullResult = await request(undefined, 'full');
                    const full = readPage(fullResult, true);
                    if (!full) return;
                    const augmented = { ...full, candidates: mergeDirectBrowseCandidates(first.candidates, full.candidates, 'merge') };
                    const fullPages = await rebuildWindow(augmented);
                    if (fullPages) commitPages(fullPages, fullResult);
                } catch {
                    // 完整搜索失败保留快搜及不完整提示，不抹掉已得到的结果。
                }
            } catch (loadError) {
                if (isCurrent()) setError(loadError instanceof Error ? loadError.message : t('directSessions.browseFailedToLoad'));
            } finally {
                // 删除只废弃数据代次；仍等实际请求结束再释放单飞，防止并行重启。
                if (flightRef.current === flight) {
                    flightRef.current = null;
                    setLoading(false);
                    setLoadingMore(false);
                    setSearchAugmenting(false);
                    setSettledVersion((value) => value + 1);
                }
            }
        };
        flight.promise = run();
        return flight.promise;
    }, [scopeKey]);

    /** 范围改变才清空窗口；旧网络请求无法取消，但其回包和 finally 均不再生效。 */
    React.useEffect(() => {
        generationRef.current += 1;
        flightRef.current = null;
        // 查询和前台范围同批改变时，这次初始加载已经使用新范围，不再被恢复 effect 重启。
        appliedObservationScopeRef.current = controlsRef.current.observationScope;
        pagesRef.current = [];
        refreshRequiredRef.current = false;
        setCandidates([]);
        setNextCursor(null);
        setRefreshRequired(false);
        setError(null);
        setSearchIncomplete(false);
        setSearchAugmenting(false);
        setLoading(false);
        setLoadingMore(false);
        setCanDeleteCandidates(false);
        if (controlsRef.current.autoRefreshEnabled !== false) {
            void loadCandidates({ automatic: controlsRef.current.autoRefreshEnabled === true });
        }
        return () => { generationRef.current += 1; flightRef.current = null; };
    }, [loadCandidates]);

    /** Android 单调时钟可能不含深睡；切换前台范围时废弃观测和旧 flight，保留分页窗口。 */
    React.useEffect(() => {
        if (appliedObservationScopeRef.current === params.observationScope) return;
        appliedObservationScopeRef.current = params.observationScope;
        generationRef.current += 1;
        flightRef.current = null;
        // 原行、页数和游标保持不变；原观测持有的范围已同步失效，无需重写时间或复制各页。
        setLoading(false);
        setLoadingMore(false);
        setSearchAugmenting(false);
        setSettledVersion((value) => value + 1);
    }, [params.observationScope]);

    /** 前台、返回、重连共同形成一个可用边沿，进行中的请求直接复用。 */
    React.useEffect(() => {
        if (params.autoRefreshEnabled) void loadCandidates({ automatic: true });
    }, [params.autoRefreshEnabled, params.observationScope, loadCandidates]);

    /** 动作期间新建的查询尚无窗口，释放后补上首次加载；已有窗口只恢复低频计时。 */
    React.useEffect(() => {
        if (!params.actionPending && pagesRef.current.length === 0 && controlsRef.current.autoRefreshEnabled !== false) {
            void loadCandidates({ automatic: controlsRef.current.autoRefreshEnabled === true });
        }
    }, [params.actionPending, loadCandidates]);

    /** 单次定时在上一轮结束后建立；失焦、后台、离线、动作及搜索立即停止周期调度。 */
    React.useEffect(() => {
        if (!params.autoRefreshEnabled || params.actionPending || query || flightRef.current) return;
        const timeout = setTimeout(() => { void loadCandidates({ automatic: true }); }, DISCOVERY_INTERVAL_MS);
        return () => clearTimeout(timeout);
    }, [params.autoRefreshEnabled, params.actionPending, query, loadCandidates, loading, loadingMore, searchAugmenting, settledVersion]);

    /** 翻页只追加一个有效游标页，和刷新共享进行中的请求。 */
    const loadMore = React.useCallback(() => loadCandidates({ append: true }), [loadCandidates]);
    /** 用户刷新先更新已显示行的事实，完整成功后才替换已读窗口的成员与页边界。 */
    const refresh = React.useCallback(() => loadCandidates(), [loadCandidates]);
    /** 成功删除同时移除各页中的条目并作废旧回包，防止会话被旧刷新复活。 */
    const removeCandidate = React.useCallback((remoteSessionId: string) => {
        if (scopeRef.current !== scopeKey) return;
        generationRef.current += 1;
        pagesRef.current = pagesRef.current.map((page) => ({ ...page, candidates: page.candidates.filter((candidate) => candidate.remoteSessionId !== remoteSessionId) }));
        setCandidates((current) => current.filter((candidate) => candidate.remoteSessionId !== remoteSessionId));
    }, [scopeKey]);

    return { candidates, nextCursor, loading, loadingMore, searchAugmenting, searchIncomplete, refreshRequired,
        refresh, error, canDeleteCandidates, loadMore, removeCandidate } as const;
}
