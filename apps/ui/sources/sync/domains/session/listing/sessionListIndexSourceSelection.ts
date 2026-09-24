import type { SessionListStorageFilter } from '@/sync/domains/session/sessionStorageKind';

import type { SessionListIndexItem } from './sessionListIndex';
import { normalizeTrimmedString } from './normalizeTrimmedString';
import { normalizeTrimmedStringArrayWithSharedEmpty } from './normalizeTrimmedStringArrayWithSharedEmpty';

const EMPTY_VISIBLE_SESSION_LIST_SUMMARY = Object.freeze({ sessionsReady: true, sessionCount: 0 });
const LOADING_VISIBLE_SESSION_LIST_SUMMARY = Object.freeze({ sessionsReady: false, sessionCount: 0 });

export type VisibleSessionListSummary = Readonly<{
    sessionsReady: boolean;
    sessionCount: number;
}>;

export type ResolveSessionListSourceIndexParams = Readonly<{
    enabled: boolean;
    activeServerId: string;
    activeIndex: ReadonlyArray<SessionListIndexItem> | null;
    byServerId?: Readonly<Record<string, ReadonlyArray<SessionListIndexItem> | null | undefined>>;
    selectedServerIds?: ReadonlyArray<string>;
}>;

type ResolvedSelectedServerSources = Readonly<{
    selectedServerIds: ReadonlyArray<string>;
    activeServerId: string;
    scoped: Readonly<Record<string, ReadonlyArray<SessionListIndexItem> | null | undefined>>;
    selectedSources: ReadonlyArray<ReadonlyArray<SessionListIndexItem>>;
    usedOnlyActiveIndexSource: boolean;
    hasResolvedSelectedSource: boolean;
    hasUnresolvedSelectedSource: boolean;
}>;

function resolveSelectedServerSources(
    params: ResolveSessionListSourceIndexParams,
): ResolvedSelectedServerSources | null {
    const selectedServerIds = normalizeTrimmedStringArrayWithSharedEmpty(params.selectedServerIds);
    if (selectedServerIds.length === 0) {
        return null;
    }

    const activeServerId = normalizeTrimmedString(params.activeServerId);
    const scoped = params.byServerId ?? {};
    const selectedSources: ReadonlyArray<SessionListIndexItem>[] = [];
    let usedOnlyActiveIndexSource = true;
    let hasResolvedSelectedSource = false;
    let hasUnresolvedSelectedSource = false;

    for (const serverId of selectedServerIds) {
        const fromCache = scoped[serverId];
        const source = serverId === activeServerId
            ? (params.activeIndex ?? fromCache ?? null)
            : (fromCache ?? null);
        if (source == null) {
            hasUnresolvedSelectedSource = true;
            continue;
        }

        hasResolvedSelectedSource = true;
        if (source !== params.activeIndex) {
            usedOnlyActiveIndexSource = false;
        }
        selectedSources.push(source);
    }

    return {
        selectedServerIds,
        activeServerId,
        scoped,
        selectedSources,
        usedOnlyActiveIndexSource,
        hasResolvedSelectedSource,
        hasUnresolvedSelectedSource,
    };
}

export function resolveSessionListSourceIndex(
    params: ResolveSessionListSourceIndexParams,
): ReadonlyArray<SessionListIndexItem> | null {
    if (!params.enabled) {
        return params.activeIndex;
    }

    const selectedSourcesState = resolveSelectedServerSources(params);
    if (!selectedSourcesState) {
        return params.activeIndex;
    }

    const merged: SessionListIndexItem[] = [];
    for (const source of selectedSourcesState.selectedSources) {
        merged.push(...source);
    }

    if (merged.length > 0) {
        if (
            selectedSourcesState.usedOnlyActiveIndexSource
            && params.activeIndex
            && merged.length === params.activeIndex.length
        ) {
            let matchesActiveIndex = true;
            for (let index = 0; index < merged.length; index += 1) {
                if (merged[index] !== params.activeIndex[index]) {
                    matchesActiveIndex = false;
                    break;
                }
            }

            if (matchesActiveIndex) {
                return params.activeIndex;
            }
        }
        return merged;
    }

    if (selectedSourcesState.hasResolvedSelectedSource) {
        return selectedSourcesState.usedOnlyActiveIndexSource && params.activeIndex ? params.activeIndex : merged;
    }

    if (selectedSourcesState.hasUnresolvedSelectedSource) {
        return null;
    }

    return null;
}

function resolveSessionStorageKindFromIndexItem(
    item: Extract<SessionListIndexItem, { type: 'session' }>,
): 'persisted' | 'direct' {
    return item.storageKind === 'direct' ? 'direct' : 'persisted';
}

export function resolveVisibleSessionListIndexSummary(
    params: ResolveSessionListSourceIndexParams,
    storageFilter: SessionListStorageFilter = 'all',
): VisibleSessionListSummary {
    const countSessions = (source: ReadonlyArray<SessionListIndexItem>) => {
        let sessionCount = 0;
        if (storageFilter === 'all') {
            for (const item of source) {
                if (item.type === 'session') sessionCount += 1;
            }
            return sessionCount;
        }

        for (const item of source) {
            if (item.type !== 'session') continue;
            if (resolveSessionStorageKindFromIndexItem(item) !== storageFilter) continue;
            sessionCount += 1;
        }
        return sessionCount;
    };

    if (!params.enabled) {
        const source = params.activeIndex;
        if (source === null) return LOADING_VISIBLE_SESSION_LIST_SUMMARY;
        const sessionCount = countSessions(source);
        return sessionCount === 0 ? EMPTY_VISIBLE_SESSION_LIST_SUMMARY : { sessionsReady: true, sessionCount };
    }

    const selectedSourcesState = resolveSelectedServerSources(params);
    if (!selectedSourcesState) {
        const source = params.activeIndex;
        if (source === null) return LOADING_VISIBLE_SESSION_LIST_SUMMARY;
        const sessionCount = countSessions(source);
        return sessionCount === 0 ? EMPTY_VISIBLE_SESSION_LIST_SUMMARY : { sessionsReady: true, sessionCount };
    }

    let sessionCount = 0;
    for (const source of selectedSourcesState.selectedSources) {
        sessionCount += countSessions(source);
    }

    if (selectedSourcesState.hasResolvedSelectedSource) {
        return sessionCount === 0 ? EMPTY_VISIBLE_SESSION_LIST_SUMMARY : { sessionsReady: true, sessionCount };
    }

    return LOADING_VISIBLE_SESSION_LIST_SUMMARY;
}
