import type { SessionListViewItem } from '@/sync/domains/state/storage';

type SessionListHeaderKind = Extract<SessionListViewItem, { type: 'header' }>['headerKind'];

const SESSION_LIST_PRIMARY_HEADER_KINDS = new Set<SessionListHeaderKind>([
    'attention',
    'working',
    'pinned',
    'active',
    'inactive',
    'sessions',
]);

export function isSessionListPrimaryHeaderKind(headerKind: SessionListHeaderKind | null | undefined): boolean {
    return typeof headerKind === 'string' && SESSION_LIST_PRIMARY_HEADER_KINDS.has(headerKind);
}
