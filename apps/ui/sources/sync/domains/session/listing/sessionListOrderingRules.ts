import type { SessionListIndexItem } from './sessionListIndex';
import type { SessionListFolderSortModeV1 } from './sessionListFolderSortMode';
import type { SessionListRenderableSession } from './sessionListRenderable';
import { normalizeTrimmedString } from './normalizeTrimmedString';
import { normalizeSessionListKeyParts } from './sessionListKeyNormalization';

export const SESSION_LIST_ORDERING_MODES_V1 = ['custom', 'created', 'updated'] as const;
export type SessionListOrderingModeV1 = typeof SESSION_LIST_ORDERING_MODES_V1[number];
export const SESSION_LIST_ORDERING_MODE_DEFAULT_V1: SessionListOrderingModeV1 = 'custom';

export const SESSION_LIST_UPDATED_ORDERING_BUCKET_MS = 5 * 60_000;

export type SessionListOrderingSection = 'active' | 'inactive' | 'sessions';
export type SessionListOrderingSectionMode = 'activity' | 'single';
export type SessionListOrderingGroupKind = NonNullable<Extract<SessionListIndexItem, { type: 'session' }>['groupKind']>;

export type SessionListUpdatedOrderingKey = Readonly<{
    bucket: number;
    createdAtSecondary: number;
}>;

export type SessionListOrderingTimestampSource = Readonly<{
    meaningfulActivityAt?: number | null;
    createdAt?: number | null;
}>;

export type SessionListSessionOrderingKey = Readonly<{
    updated: SessionListUpdatedOrderingKey;
    createdAt: number;
    stableId: string;
}>;

function normalizePositiveTimestamp(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeSessionListOrderingModeV1(value: unknown): SessionListOrderingModeV1 {
    return value === 'created' || value === 'updated' || value === 'custom'
        ? value
        : SESSION_LIST_ORDERING_MODE_DEFAULT_V1;
}

export function normalizeSessionListOrderingSectionMode(value: unknown): SessionListOrderingSectionMode {
    return value === 'single' ? 'single' : 'activity';
}

export function readSessionListMeaningfulActivityAt(row: SessionListOrderingTimestampSource | null | undefined): number {
    if (!row) return 0;
    return normalizePositiveTimestamp(row.meaningfulActivityAt) || normalizePositiveTimestamp(row.createdAt);
}

export function readSessionListUpdatedOrderingKey(
    row: SessionListOrderingTimestampSource | null | undefined,
    bucketMs: number = SESSION_LIST_UPDATED_ORDERING_BUCKET_MS,
): SessionListUpdatedOrderingKey {
    const normalizedBucketMs = Number.isFinite(bucketMs) && bucketMs > 0
        ? Math.trunc(bucketMs)
        : SESSION_LIST_UPDATED_ORDERING_BUCKET_MS;
    const safeBucketMs = normalizedBucketMs > 0 ? normalizedBucketMs : SESSION_LIST_UPDATED_ORDERING_BUCKET_MS;
    const meaningfulActivityAt = readSessionListMeaningfulActivityAt(row);
    return {
        bucket: meaningfulActivityAt > 0 ? Math.floor(meaningfulActivityAt / safeBucketMs) : 0,
        createdAtSecondary: normalizePositiveTimestamp(row?.createdAt),
    };
}

export function buildSessionListSessionOrderingKey(params: Readonly<{
    item: Extract<SessionListIndexItem, { type: 'session' }>;
    row: SessionListRenderableSession | null | undefined;
}>): SessionListSessionOrderingKey {
    return {
        updated: readSessionListUpdatedOrderingKey(params.row),
        createdAt: normalizePositiveTimestamp(params.row?.createdAt),
        stableId: normalizeSessionListKeyParts(params.item.serverId, params.item.sessionId).sessionKey
            || normalizeTrimmedString(params.item.sessionId),
    };
}

export function compareSessionListSessionOrderingKeys(
    a: SessionListSessionOrderingKey,
    b: SessionListSessionOrderingKey,
    orderingMode: SessionListOrderingModeV1,
): number {
    if (orderingMode === 'updated') {
        if (b.updated.bucket !== a.updated.bucket) return b.updated.bucket - a.updated.bucket;
        if (b.updated.createdAtSecondary !== a.updated.createdAtSecondary) {
            return b.updated.createdAtSecondary - a.updated.createdAtSecondary;
        }
    }

    if (orderingMode === 'created') {
        if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    }

    return a.stableId.localeCompare(b.stableId);
}

export function resolveEffectiveSessionListOrderingModeForGroup(params: Readonly<{
    section: SessionListOrderingSection | null | undefined;
    sectionMode: SessionListOrderingSectionMode;
    groupKind: SessionListOrderingGroupKind | null | undefined;
    userOrderingMode: SessionListOrderingModeV1;
}>): SessionListOrderingModeV1 {
    if (
        params.sectionMode === 'activity'
        && params.section === 'inactive'
        && params.groupKind === 'date'
    ) {
        return 'updated';
    }

    return params.userOrderingMode;
}

export function resolveEffectiveSessionListFolderSortMode(params: Readonly<{
    orderingMode: SessionListOrderingModeV1;
    folderSortMode: SessionListFolderSortModeV1;
}>): SessionListFolderSortModeV1 {
    return params.orderingMode === 'custom' ? params.folderSortMode : 'foldersFirst';
}
