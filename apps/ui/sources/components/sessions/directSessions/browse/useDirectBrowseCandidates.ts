import * as React from 'react';
import type { DirectSessionActivityV1, DirectSessionsProviderId, DirectSessionsSource } from '@happier-dev/protocol';

import { machineDirectSessionsCandidatesList } from '@/sync/ops/machineDirectSessions';
import { t } from '@/text';

export type DirectBrowseCandidate = Readonly<{
    remoteSessionId: string;
    title?: string;
    updatedAtMs: number;
    activity?: DirectSessionActivityV1;
    details?: Record<string, unknown>;
}>;

const CANDIDATES_PAGE_LIMIT = 50;

type CandidateApplyMode = 'replace' | 'append' | 'merge';

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

function mergeDirectBrowseCandidate(current: DirectBrowseCandidate, next: DirectBrowseCandidate): DirectBrowseCandidate {
    return {
        remoteSessionId: current.remoteSessionId,
        title: hasCandidateTitle(next) ? next.title : current.title,
        updatedAtMs: Math.max(current.updatedAtMs, next.updatedAtMs),
        activity: next.activity ?? current.activity,
        details: mergeCandidateDetails(current.details, next.details),
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

/** 按实际来源维护候选列表；游标失效保留旧页，显式刷新成功后再替换。 */
export function useDirectBrowseCandidates(params: Readonly<{
    machineId: string | null;
    serverId?: string | null;
    providerId: DirectSessionsProviderId | null;
    source: DirectSessionsSource | null;
    searchTerm?: string;
}>) {
    const { machineId, providerId, searchTerm, source, serverId } = params;

    const [candidates, setCandidates] = React.useState<readonly DirectBrowseCandidate[]>([]);
    const [nextCursor, setNextCursor] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [searchAugmenting, setSearchAugmenting] = React.useState(false);
    const [searchIncomplete, setSearchIncomplete] = React.useState(false);
    const [refreshRequired, setRefreshRequired] = React.useState(false);
    const appendPendingRef = React.useRef(false);
    const [error, setError] = React.useState<string | null>(null);
    const [canDeleteCandidates, setCanDeleteCandidates] = React.useState(false);

    const loadGenerationRef = React.useRef(0);

    // 每次首段加载拥有独立代次，避免切换来源或刷新后的旧响应覆盖当前视图。
    const loadCandidates = React.useCallback(async (opts?: Readonly<{ cursor?: string | null; append?: boolean; preserve?: boolean }>) => {
        if (!machineId || !providerId || !source) return;

        const append = opts?.append === true;
        const preserve = opts?.preserve === true;
        if (!append) {
            loadGenerationRef.current += 1;
            appendPendingRef.current = false;
            setLoadingMore(false);
        }
        const currentGeneration = loadGenerationRef.current;

        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
            setSearchAugmenting(false);
            if (!preserve) setSearchIncomplete(false);
            setError(null);
        }

        const normalizedSearchTerm = typeof searchTerm === 'string' ? searchTerm.trim() : '';
        const shouldStartWithFastSearch = !append && !opts?.cursor && normalizedSearchTerm.length > 0;
        const requestCandidates = async (searchMode?: 'fast' | 'full') => {
            const request = {
                machineId,
                providerId,
                source,
                limit: CANDIDATES_PAGE_LIMIT,
                ...(opts?.cursor ? { cursor: opts.cursor } : {}),
                ...(normalizedSearchTerm.length > 0 ? { searchTerm: normalizedSearchTerm } : {}),
                ...(searchMode ? { searchMode } : {}),
            };
            return serverId
                ? machineDirectSessionsCandidatesList(request, { serverId })
                : machineDirectSessionsCandidatesList(request);
        };
        const applyResult = (result: Awaited<ReturnType<typeof machineDirectSessionsCandidatesList>>, mode: CandidateApplyMode): boolean => {
            if (!result.ok) {
                if (result.refreshRequired === true) {
                    // 失效游标不能再翻页；保留当前行和游标，等用户显式刷新。
                    setRefreshRequired(true);
                    setError(null);
                    return false;
                }
                if (mode === 'merge') {
                    // 补充搜索失败仍保留快搜结果及其不完整标记，不转成覆盖列表的错误页。
                    return false;
                }
                setError(result.error);
                if (!append && !preserve) {
                    setCandidates([]);
                    setNextCursor(null);
                    setCanDeleteCandidates(false);
                }
                return false;
            }

            // 未得到完整搜索的可用首段时，继续保留快搜的同一分页依据。
            if (mode === 'merge' && result.searchIncomplete && result.candidates.length === 0) return false;
            const nextItems = result.candidates.map((candidate) => ({
                remoteSessionId: candidate.remoteSessionId,
                title: candidate.title,
                updatedAtMs: candidate.updatedAtMs,
                activity: candidate.activity,
                details: candidate.details,
            })) satisfies readonly DirectBrowseCandidate[];

            setCandidates((current) => {
                if (mode !== 'replace') return mergeDirectBrowseCandidates(current, nextItems, mode);
                return nextItems;
            });
            setSearchIncomplete(result.searchIncomplete === true);
            // 候选与 cursor 必须来自同一次响应；不能把 full 的列表配给 fast 的 offset。
            setNextCursor(result.nextCursor ?? null);
            setRefreshRequired(false);
            setCanDeleteCandidates(result.capabilities?.deleteCandidate === true);
            setError(null);
            return true;
        };

        try {
            const result = await requestCandidates(shouldStartWithFastSearch ? 'fast' : undefined);

            if (loadGenerationRef.current !== currentGeneration) {
                return;
            }

            const ok = applyResult(result, append ? 'append' : 'replace');
            if (!ok || !shouldStartWithFastSearch || !result.ok || !result.searchIncomplete) {
                return;
            }

            setLoading(false);
            setSearchAugmenting(true);
            try {
                const augmentedResult = await requestCandidates('full');
                if (loadGenerationRef.current !== currentGeneration) {
                    return;
                }
                applyResult(augmentedResult, 'merge');
            } catch {
                // 网络失败时沿用快搜结果和不完整提示；旧请求不写入新一轮搜索状态。
            }
        } catch (loadError) {
            if (loadGenerationRef.current !== currentGeneration) {
                return;
            }
            const message = loadError instanceof Error ? loadError.message : t('directSessions.browseFailedToLoad');
            setError(message);
            if (!append && !preserve) {
                setCandidates([]);
                setNextCursor(null);
                setCanDeleteCandidates(false);
            }
        } finally {
            if (loadGenerationRef.current === currentGeneration) {
                if (append) {
                    setLoadingMore(false);
                    appendPendingRef.current = false;
                } else {
                    setLoading(false);
                    setSearchAugmenting(false);
                }
            }
        }
    }, [machineId, providerId, searchTerm, serverId, source]);

    React.useEffect(() => {
        // 机器、来源、筛选或实际服务器变化时清空视图，并作废旧范围的回包。
        setCandidates([]);
        setNextCursor(null);
        setRefreshRequired(false);
        setError(null);
        setSearchIncomplete(false);
        setSearchAugmenting(false);
        setLoading(false);
        setLoadingMore(false);
        setCanDeleteCandidates(false);
        appendPendingRef.current = false;
        void loadCandidates();
        return () => { loadGenerationRef.current += 1; };
    }, [loadCandidates]);

    // 完整搜索、刷新与失效游标都不能继续追加旧分页，重复点击也只发一次。
    const loadMore = React.useCallback(async () => {
        if (!nextCursor || loading || loadingMore || searchAugmenting || refreshRequired || appendPendingRef.current) return;
        appendPendingRef.current = true;
        await loadCandidates({ cursor: nextCursor, append: true });
    }, [loadCandidates, loading, loadingMore, searchAugmenting, refreshRequired, nextCursor]);

    // 同范围刷新继续显示旧行；成功后整体替换，失败不抹掉已读内容。
    const refresh = React.useCallback(async () => {
        await loadCandidates({ preserve: true });
    }, [loadCandidates]);

    const removeCandidate = React.useCallback((remoteSessionId: string) => {
        setCandidates((current) => current.filter((candidate) => candidate.remoteSessionId !== remoteSessionId));
    }, []);

    return {
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
    } as const;
}
