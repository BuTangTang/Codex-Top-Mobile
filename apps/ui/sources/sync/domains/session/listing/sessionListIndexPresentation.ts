import type { ServerSelectionPresentation } from '@/sync/domains/server/selection/serverSelectionTypes';

import type { SessionListIndexItem } from './sessionListIndex';
import { normalizeTrimmedString } from './normalizeTrimmedString';
import { normalizeTrimmedStringArrayWithSharedEmpty } from './normalizeTrimmedStringArrayWithSharedEmpty';

export {
    resolveSessionListSourceIndex,
    resolveVisibleSessionListIndexSummary,
    type ResolveSessionListSourceIndexParams,
    type VisibleSessionListSummary,
} from './sessionListIndexSourceSelection';

type ApplySessionListPresentationParams = Readonly<{
    enabled: boolean;
    presentation: ServerSelectionPresentation;
    selectedServerIds?: ReadonlyArray<string>;
}>;

const EMPTY_SESSION_LIST_INDEX_ITEMS: SessionListIndexItem[] = [];

function stripSyntheticServerHeaders(data: ReadonlyArray<SessionListIndexItem>): SessionListIndexItem[] {
    return data.filter((item) => !(item.type === 'header' && item.headerKind === 'server'));
}

type VisibleServerCoverage = Readonly<{
    distinctServerCount: number;
    coversVisibleServerIds: boolean;
    coversVisibleSessionServerIds: boolean;
    hasSyntheticServerHeaders: boolean;
    isAlreadyCanonicalGroupedServerPresentation: boolean;
}>;

function resolveVisibleServerCoverage(
    data: ReadonlyArray<SessionListIndexItem>,
    selectedServerSet: ReadonlySet<string>,
): VisibleServerCoverage {
    const distinctServerIds = new Set<string>();
    let currentServerId: string | null = null;
    let seenSessionInCurrentGroup = false;
    let sawServerGroup = false;
    let coversVisibleServerIds = true;
    let coversVisibleSessionServerIds = true;
    let hasSyntheticServerHeaders = false;
    let isAlreadyCanonicalGroupedServerPresentation = false;

    for (const item of data) {
        if (item.type === 'header') {
            if (item.headerKind === 'server') {
                hasSyntheticServerHeaders = true;
                coversVisibleServerIds = false;
                if (sawServerGroup && !seenSessionInCurrentGroup) {
                    coversVisibleSessionServerIds = false;
                    isAlreadyCanonicalGroupedServerPresentation = false;
                }

                currentServerId = normalizeTrimmedString(item.serverId);
                if (!currentServerId) {
                    coversVisibleServerIds = false;
                    coversVisibleSessionServerIds = false;
                    break;
                }

                sawServerGroup = true;
                seenSessionInCurrentGroup = false;
                isAlreadyCanonicalGroupedServerPresentation = true;
                continue;
            }

            isAlreadyCanonicalGroupedServerPresentation = false;
            continue;
        }

        const serverId = normalizeTrimmedString(item.serverId);
        if (!serverId) {
            isAlreadyCanonicalGroupedServerPresentation = false;
            continue;
        }

        distinctServerIds.add(serverId);
        if (!selectedServerSet.has(serverId)) {
            coversVisibleServerIds = false;
            coversVisibleSessionServerIds = false;
        }

        if (currentServerId && serverId !== currentServerId) {
            coversVisibleServerIds = false;
            coversVisibleSessionServerIds = false;
            isAlreadyCanonicalGroupedServerPresentation = false;
        }

        seenSessionInCurrentGroup = true;
    }

    if (sawServerGroup && !seenSessionInCurrentGroup) {
        coversVisibleSessionServerIds = false;
    }

    return {
        distinctServerCount: distinctServerIds.size,
        coversVisibleServerIds,
        coversVisibleSessionServerIds,
        hasSyntheticServerHeaders,
        isAlreadyCanonicalGroupedServerPresentation:
            hasSyntheticServerHeaders && isAlreadyCanonicalGroupedServerPresentation && seenSessionInCurrentGroup,
    };
}

function filterIndexBySelectedServers(
    data: ReadonlyArray<SessionListIndexItem>,
    selectedServerSet: ReadonlySet<string>,
): ReadonlyArray<SessionListIndexItem> {
    if (selectedServerSet.size === 0) return data;

    const filtered: SessionListIndexItem[] = [];
    const pendingUnscoped: SessionListIndexItem[] = [];
    for (const item of data) {
        const serverId = normalizeTrimmedString(item.serverId);
        if (!serverId) {
            pendingUnscoped.push(item);
            continue;
        }
        if (!selectedServerSet.has(serverId)) {
            pendingUnscoped.length = 0;
            continue;
        }
        if (pendingUnscoped.length > 0) {
            filtered.push(...pendingUnscoped);
            pendingUnscoped.length = 0;
        }
        filtered.push(item);
    }
    return filtered;
}

function buildGroupedServerPresentation(data: ReadonlyArray<SessionListIndexItem>): SessionListIndexItem[] {
    const serverOrder: string[] = [];
    const groups = new Map<string, SessionListIndexItem[]>();
    const unknownServerKey = '__unknown_server__';
    const pendingUnscopedItems: SessionListIndexItem[] = [];

    for (const item of data) {
        const scopedId = normalizeTrimmedString(item.serverId);
        if (!scopedId) {
            pendingUnscopedItems.push(item);
            continue;
        }
        if (!groups.has(scopedId)) {
            groups.set(scopedId, []);
            serverOrder.push(scopedId);
        }
        if (pendingUnscopedItems.length > 0) {
            groups.get(scopedId)!.push(...pendingUnscopedItems);
            pendingUnscopedItems.length = 0;
        }
        groups.get(scopedId)!.push(item);
    }

    if (pendingUnscopedItems.length > 0) {
        if (!groups.has(unknownServerKey)) {
            groups.set(unknownServerKey, []);
            serverOrder.push(unknownServerKey);
        }
        groups.get(unknownServerKey)!.push(...pendingUnscopedItems);
    }

    const out: SessionListIndexItem[] = [];
    for (const serverId of serverOrder) {
        const items = groups.get(serverId);
        if (!items || items.length === 0) continue;

        const serverName = items.find((item) => item.type === 'session' && normalizeTrimmedString(item.serverName))?.serverName
            ?? items.find((item) => item.type === 'header' && normalizeTrimmedString(item.serverName))?.serverName
            ?? null;
        const title = serverName ? String(serverName) : (serverId !== unknownServerKey ? serverId : 'Unknown server');

        out.push({
            type: 'header',
            title,
            headerKind: 'server',
            groupKey: `server:${serverId}`,
            serverId,
            serverName: serverName ? String(serverName) : undefined,
        });
        out.push(...items);
    }
    return out;
}

export function applySessionListIndexPresentation(
    data: ReadonlyArray<SessionListIndexItem>,
    params: ApplySessionListPresentationParams,
): ReadonlyArray<SessionListIndexItem> {
    if (!params.enabled) return data;

    const selectedServerIds = normalizeTrimmedStringArrayWithSharedEmpty(params.selectedServerIds);
    const selectedServerSet = new Set(selectedServerIds);
    const visibleServerCoverage = resolveVisibleServerCoverage(data, selectedServerSet);

    if (selectedServerSet.size === 0 && !visibleServerCoverage.hasSyntheticServerHeaders) {
        if (params.presentation === 'flat-with-badge') return data;
        if (visibleServerCoverage.distinctServerCount <= 1) return data;
    }

    if (
        params.presentation === 'flat-with-badge'
        && selectedServerSet.size > 0
        && !visibleServerCoverage.hasSyntheticServerHeaders
        && visibleServerCoverage.coversVisibleServerIds
    ) {
        return data;
    }

    if (
        params.presentation === 'grouped'
        && selectedServerSet.size > 0
        && !visibleServerCoverage.hasSyntheticServerHeaders
        && visibleServerCoverage.distinctServerCount <= 1
        && visibleServerCoverage.coversVisibleServerIds
    ) {
        return data;
    }

    const withoutServerHeaders = visibleServerCoverage.hasSyntheticServerHeaders ? stripSyntheticServerHeaders(data) : data;
    const filteredBySelection = filterIndexBySelectedServers(withoutServerHeaders, selectedServerSet);

    if (filteredBySelection.length === 0) return EMPTY_SESSION_LIST_INDEX_ITEMS;
    if (params.presentation === 'flat-with-badge') return filteredBySelection;

    if (
        params.presentation === 'grouped'
        && selectedServerSet.size > 0
        && visibleServerCoverage.isAlreadyCanonicalGroupedServerPresentation
        && visibleServerCoverage.coversVisibleSessionServerIds
    ) {
        return data;
    }

    if (selectedServerSet.size === 0 && visibleServerCoverage.isAlreadyCanonicalGroupedServerPresentation) {
        return data;
    }

    if (resolveVisibleServerCoverage(filteredBySelection, selectedServerSet).distinctServerCount <= 1) {
        return filteredBySelection;
    }

    return buildGroupedServerPresentation(filteredBySelection);
}
