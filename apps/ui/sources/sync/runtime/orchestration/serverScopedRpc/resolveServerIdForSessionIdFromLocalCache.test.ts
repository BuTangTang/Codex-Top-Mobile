import { describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/state/storage';

import {
    resolveServerIdForSessionIdFromLocalState,
    resolveServerIdForSessionIdFromSessionListCache,
} from './resolveServerIdForSessionIdFromLocalCache';

function makeRenderableSession(
    partial: Partial<SessionListRenderableSession> & Pick<SessionListRenderableSession, 'id'>,
): SessionListRenderableSession {
    const createdAt = partial.createdAt ?? 0;
    const active = partial.active ?? true;
    const activeAt = partial.activeAt ?? createdAt;
    const updatedAt = partial.updatedAt ?? createdAt;
    return {
        id: partial.id,
        seq: partial.seq ?? 0,
        createdAt,
        updatedAt,
        active,
        activeAt,
        archivedAt: partial.archivedAt ?? null,
        pendingVersion: partial.pendingVersion,
        pendingCount: partial.pendingCount,
        metadataVersion: partial.metadataVersion ?? 0,
        agentStateVersion: partial.agentStateVersion ?? 0,
        metadata: partial.metadata ?? null,
        thinking: partial.thinking ?? false,
        thinkingAt: partial.thinkingAt ?? 0,
        presence: partial.presence ?? (active ? 'online' : activeAt),
        optimisticThinkingAt: partial.optimisticThinkingAt ?? null,
        thinkingGraceUntil: partial.thinkingGraceUntil ?? null,
        owner: partial.owner,
        accessLevel: partial.accessLevel,
        canApprovePermissions: partial.canApprovePermissions,
        hasPendingPermissionRequests: partial.hasPendingPermissionRequests,
        hasPendingUserActionRequests: partial.hasPendingUserActionRequests,
        keepVisibleWhenInactive: partial.keepVisibleWhenInactive,
    };
}

describe('resolveServerIdForSessionIdFromSessionListCache', () => {
    it('returns the matching serverId when the session appears in the cached list', () => {
        const cache: Record<string, SessionListViewItem[] | null> = {
            'server-a': [
                { type: 'header', title: 'x' },
                { type: 'session', session: makeRenderableSession({ id: 's1' }) },
            ],
            'server-b': [{ type: 'session', session: makeRenderableSession({ id: 's2' }) }],
        };

        expect(resolveServerIdForSessionIdFromSessionListCache(cache, 's1')).toBe('server-a');
        expect(resolveServerIdForSessionIdFromSessionListCache(cache, 's2')).toBe('server-b');
    });

    it('returns null when the cache is empty or the session id is not found', () => {
        expect(resolveServerIdForSessionIdFromSessionListCache({}, 's1')).toBeNull();
        expect(resolveServerIdForSessionIdFromSessionListCache({ 'server-a': null }, 's1')).toBeNull();
    });
});

describe('resolveServerIdForSessionIdFromLocalState', () => {
    const makeSessionListItem = (id: string) => ({ type: 'session' as const, session: makeRenderableSession({ id }) });

    it('prefers the session map serverId when available', () => {
        const state = {
            sessions: {
                s1: { serverId: 'server-a' },
            },
            sessionListViewDataByServerId: {
                'server-b': [makeSessionListItem('s1')],
            },
        } satisfies Parameters<typeof resolveServerIdForSessionIdFromLocalState>[0];

        expect(resolveServerIdForSessionIdFromLocalState(state, 's1')).toBe('server-a');
    });

    it('falls back to the session list cache when the session map is missing', () => {
        const state = {
            sessions: {},
            sessionListViewDataByServerId: {
                'server-b': [makeSessionListItem('s2')],
            },
        } satisfies Parameters<typeof resolveServerIdForSessionIdFromLocalState>[0];

        expect(resolveServerIdForSessionIdFromLocalState(state, 's2')).toBe('server-b');
    });
});
