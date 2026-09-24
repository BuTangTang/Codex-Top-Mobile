import * as React from 'react';

import { runTasksWithLimit } from '@/sync/runtime/orchestration/runTasksWithLimit';
import { sync } from '@/sync/sync';
import { fireAndForget } from '@/utils/system/fireAndForget';

export type SidechainHydrationStatus =
    | 'idle'
    | 'loading'
    | 'in_flight'
    | 'loaded'
    | 'not_ready'
    | 'retrying'
    | 'error';

export type SidechainHydrationEntry = Readonly<{
    key: string;
    sessionId: string;
    sidechainId: string;
    status: SidechainHydrationStatus;
    retryCount: number;
}>;

export type SidechainHydrationSnapshot = Readonly<{
    status: SidechainHydrationStatus;
    entries: readonly SidechainHydrationEntry[];
    bySidechainId: Readonly<Record<string, SidechainHydrationEntry>>;
    pendingCount: number;
    loadedCount: number;
}>;

type NormalizedSidechainRequest = Readonly<{
    key: string;
    sessionId: string;
    sidechainId: string;
}>;

const DEFAULT_SIDECHAIN_DEMAND_HYDRATION_CONCURRENCY_LIMIT = 2;

function readEnsureSidechainRetryDelayMsFromEnv(): number {
    const raw = String(process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_RETRY_MS ?? '').trim();
    if (!raw) return 250;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 250;
    return Math.max(10, Math.min(10_000, parsed));
}

function readEnsureSidechainMaxRetriesFromEnv(): number {
    const raw = String(process.env.EXPO_PUBLIC_HAPPIER_ENSURE_SIDECHAIN_MAX_RETRIES ?? '').trim();
    if (!raw) return 6;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 6;
    return Math.max(0, Math.min(100, parsed));
}

function computeRetryDelayMs(retryCount: number): number {
    const baseDelayMs = readEnsureSidechainRetryDelayMsFromEnv();
    const exponent = Math.max(0, Math.min(6, retryCount));
    return Math.min(30_000, baseDelayMs * (2 ** exponent));
}

function readSidechainDemandHydrationConcurrencyLimit(): number {
    type SyncWithOptionalTuning = Readonly<{
        getSyncTuning?: () => Readonly<{
            sidechainDemandHydrationConcurrencyLimit?: number;
        }>;
    }>;
    const maybeSync = sync as SyncWithOptionalTuning;
    const raw = maybeSync.getSyncTuning?.().sidechainDemandHydrationConcurrencyLimit;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return DEFAULT_SIDECHAIN_DEMAND_HYDRATION_CONCURRENCY_LIMIT;
    }
    return Math.max(1, Math.min(8, Math.trunc(raw)));
}

function createRequestKey(sessionId: string, sidechainId: string): string {
    return `${sessionId}\n${sidechainId}`;
}

function normalizeSidechainRequests(params: Readonly<{
    enabled: boolean;
    sessionId?: string;
    sidechainIds: readonly (string | null | undefined)[];
}>): readonly NormalizedSidechainRequest[] {
    if (!params.enabled) return [];
    const normalizedSessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
    if (!normalizedSessionId) return [];

    const seen = new Set<string>();
    const requests: NormalizedSidechainRequest[] = [];
    for (const rawSidechainId of params.sidechainIds) {
        const normalizedSidechainId = typeof rawSidechainId === 'string' ? rawSidechainId.trim() : '';
        if (!normalizedSidechainId) continue;
        const key = createRequestKey(normalizedSessionId, normalizedSidechainId);
        if (seen.has(key)) continue;
        seen.add(key);
        requests.push({
            key,
            sessionId: normalizedSessionId,
            sidechainId: normalizedSidechainId,
        });
    }
    return requests;
}

function createSidechainIdsSignature(sidechainIds: readonly (string | null | undefined)[]): string {
    return JSON.stringify(sidechainIds.map((sidechainId) =>
        (typeof sidechainId === 'string' ? sidechainId.trim() : '')));
}

function createIdleSnapshot(): SidechainHydrationSnapshot {
    return {
        status: 'idle',
        entries: [],
        bySidechainId: {},
        pendingCount: 0,
        loadedCount: 0,
    };
}

function aggregateSidechainHydrationStatus(entries: readonly SidechainHydrationEntry[]): SidechainHydrationStatus {
    if (entries.length === 0) return 'idle';
    if (entries.some((entry) => entry.status === 'error')) return 'error';
    if (entries.some((entry) => entry.status === 'retrying')) return 'retrying';
    if (entries.some((entry) => entry.status === 'not_ready')) return 'not_ready';
    if (entries.some((entry) => entry.status === 'loading')) return 'loading';
    if (entries.some((entry) => entry.status === 'in_flight')) return 'in_flight';
    if (entries.every((entry) => entry.status === 'loaded')) return 'loaded';
    return 'loading';
}

function buildSidechainHydrationSnapshot(
    requests: readonly NormalizedSidechainRequest[],
    entryState: Readonly<Record<string, SidechainHydrationEntry>>,
): SidechainHydrationSnapshot {
    if (requests.length === 0) return createIdleSnapshot();

    const entries = requests.map((request) => entryState[request.key] ?? {
        key: request.key,
        sessionId: request.sessionId,
        sidechainId: request.sidechainId,
        status: 'idle' as const,
        retryCount: 0,
    });
    const bySidechainId: Record<string, SidechainHydrationEntry> = {};
    let loadedCount = 0;
    let pendingCount = 0;
    for (const entry of entries) {
        bySidechainId[entry.sidechainId] = entry;
        if (entry.status === 'loaded') {
            loadedCount += 1;
        } else if (entry.status !== 'idle') {
            pendingCount += 1;
        }
    }

    return {
        status: aggregateSidechainHydrationStatus(entries),
        entries,
        bySidechainId,
        pendingCount,
        loadedCount,
    };
}

export function useEnsureSidechainsLoaded(params: Readonly<{
    enabled: boolean;
    sessionId?: string;
    sidechainIds: readonly (string | null | undefined)[];
}>): SidechainHydrationSnapshot {
    const requestedKeysRef = React.useRef<Set<string>>(new Set());
    const retryTimeoutsRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const retryCountsRef = React.useRef<Map<string, number>>(new Map());
    const [retryTick, bumpRetryTick] = React.useReducer((value: number) => value + 1, 0);
    const [entryState, setEntryState] = React.useState<Record<string, SidechainHydrationEntry>>({});

    const sidechainIdsSignature = createSidechainIdsSignature(params.sidechainIds);
    const requests = React.useMemo(
        () => normalizeSidechainRequests(params),
        [params.enabled, params.sessionId, sidechainIdsSignature],
    );
    const requestsRef = React.useRef<readonly NormalizedSidechainRequest[]>(requests);
    requestsRef.current = requests;
    const requestsSignature = requests.map((request) => request.key).join('\u0000');

    const updateEntryStatus = React.useCallback((
        request: NormalizedSidechainRequest,
        status: SidechainHydrationStatus,
    ) => {
        const retryCount = retryCountsRef.current.get(request.key) ?? 0;
        setEntryState((current) => ({
            ...current,
            [request.key]: {
                key: request.key,
                sessionId: request.sessionId,
                sidechainId: request.sidechainId,
                status,
                retryCount,
            },
        }));
    }, []);

    const clearRetry = React.useCallback((requestKey: string) => {
        const existing = retryTimeoutsRef.current.get(requestKey);
        if (existing === undefined) return;
        clearTimeout(existing);
        retryTimeoutsRef.current.delete(requestKey);
    }, []);

    const resetRetryState = React.useCallback((requestKey: string) => {
        clearRetry(requestKey);
        retryCountsRef.current.delete(requestKey);
    }, [clearRetry]);

    const scheduleRetry = React.useCallback((requestKey: string, options?: Readonly<{
        countRetry?: boolean;
        respectMaxRetries?: boolean;
    }>): boolean => {
        if (retryTimeoutsRef.current.has(requestKey)) return true;
        const retryCount = retryCountsRef.current.get(requestKey) ?? 0;
        const countRetry = options?.countRetry ?? true;
        const respectMaxRetries = options?.respectMaxRetries ?? true;
        if (respectMaxRetries && retryCount >= readEnsureSidechainMaxRetriesFromEnv()) return false;
        if (countRetry) {
            retryCountsRef.current.set(requestKey, retryCount + 1);
        }
        const timeoutId = setTimeout(() => {
            retryTimeoutsRef.current.delete(requestKey);
            bumpRetryTick();
        }, computeRetryDelayMs(retryCount));
        retryTimeoutsRef.current.set(requestKey, timeoutId);
        return true;
    }, []);

    React.useEffect(() => {
        return () => {
            for (const timeoutId of retryTimeoutsRef.current.values()) {
                clearTimeout(timeoutId);
            }
            retryTimeoutsRef.current.clear();
            retryCountsRef.current.clear();
        };
    }, []);

    React.useEffect(() => {
        const pendingRequests = requestsRef.current.filter((request) => !requestedKeysRef.current.has(request.key));
        if (pendingRequests.length === 0) return;

        for (const request of pendingRequests) {
            requestedKeysRef.current.add(request.key);
            updateEntryStatus(request, 'loading');
        }

        const tasks = pendingRequests.map((request) => async () => {
            try {
                const status = await sync.ensureSidechainMessagesLoaded(request.sessionId, request.sidechainId);
                if (status === 'in_flight') {
                    requestedKeysRef.current.delete(request.key);
                    scheduleRetry(request.key, { countRetry: false, respectMaxRetries: false });
                    updateEntryStatus(request, 'in_flight');
                    return status;
                }
                if (status === 'not_ready') {
                    requestedKeysRef.current.delete(request.key);
                    updateEntryStatus(request, scheduleRetry(request.key) ? 'retrying' : 'not_ready');
                    return status;
                }

                if (status === 'loaded') {
                    resetRetryState(request.key);
                    updateEntryStatus(request, 'loaded');
                    return status;
                }

                return status;
            } catch (error) {
                requestedKeysRef.current.delete(request.key);
                updateEntryStatus(request, scheduleRetry(request.key) ? 'retrying' : 'error');
                return 'not_ready' as const;
            }
        });

        const request = runTasksWithLimit(tasks, readSidechainDemandHydrationConcurrencyLimit());

        fireAndForget(request, { tag: 'useEnsureSidechainsLoaded' });
    }, [requestsSignature, resetRetryState, retryTick, scheduleRetry, updateEntryStatus]);

    return React.useMemo(
        () => buildSidechainHydrationSnapshot(requests, entryState),
        [entryState, requests],
    );
}
