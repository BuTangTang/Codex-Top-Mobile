import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from './sessionListViewData';
import type { SessionListRenderableSession } from './sessionListRenderable';
import {
    normalizeSessionListGroupOrderV1ForSource,
    normalizeSessionListGroupOrderV1ForStructuralSource,
    PINNED_GROUP_KEY_V1,
    resolveProjectGroupKey,
    SESSION_LIST_GROUP_ORDER_MAX_KEYS_PER_GROUP,
} from './sessionListOrderingStateV1';

function makeSession(id: string): SessionListRenderableSession {
    return {
        id,
        seq: 0,
        createdAt: 0,
        updatedAt: 0,
        active: false,
        activeAt: 0,
        archivedAt: null,
        pendingVersion: undefined,
        pendingCount: undefined,
        metadataVersion: 0,
        agentStateVersion: 0,
        metadata: null,
        thinking: false,
        thinkingAt: 0,
        presence: 0,
        owner: undefined,
        accessLevel: undefined,
        canApprovePermissions: undefined,
        hasPendingPermissionRequests: undefined,
        hasPendingUserActionRequests: undefined,
        hasUnreadMessages: false,
        keepVisibleWhenInactive: false,
    };
}

function makeSessionItem(opts: Readonly<{ serverId: string; sessionId: string; groupKey: string }>): SessionListViewItem {
    return {
        type: 'session',
        serverId: opts.serverId,
        session: makeSession(opts.sessionId),
        groupKey: opts.groupKey,
    };
}

describe('sessionListOrderingStateV1', () => {
    it('resolves canonical project group keys from folder child group keys', () => {
        expect(resolveProjectGroupKey('server:s1:project:abc123:folder:planning')).toBe('server:s1:project:abc123');
        expect(resolveProjectGroupKey('server:s1:project:abc123')).toBe('server:s1:project:abc123');
        expect(resolveProjectGroupKey('folder:s1:workspaceScope:s1:m1:/repo:planning')).toBe('folder:s1:workspaceScope:s1:m1:/repo:planning');
    });

    it('removes missing session keys from group order when the group is present in the source', () => {
        const g = 'server:s1:day:2026-02-17';
        const source: SessionListViewItem[] = [
            { type: 'header', title: 'Today', headerKind: 'date', groupKey: g, serverId: 's1' },
            makeSessionItem({ serverId: 's1', sessionId: 'a', groupKey: g }),
        ];

        const normalized = normalizeSessionListGroupOrderV1ForSource({
            source,
            pinnedSessionKeysV1: [],
            sessionListGroupOrderV1: { [g]: ['s1:a', 's1:missing'] },
        });

        expect(normalized).toEqual({ [g]: ['s1:a'] });
    });

    it('preserves folder keys that are direct children of the ordered group', () => {
        const projectGroupKey = 'server:s1:project:abc123';
        const folderGroupKey = `${projectGroupKey}:folder:planning`;
        const source: SessionListViewItem[] = [
            { type: 'header', title: 'Repo', headerKind: 'project', groupKey: projectGroupKey, serverId: 's1' },
            {
                type: 'header',
                title: 'Planning',
                headerKind: 'folder',
                groupKey: folderGroupKey,
                folderId: 'planning',
                parentFolderId: null,
                depth: 1,
                serverId: 's1',
            },
            makeSessionItem({ serverId: 's1', sessionId: 'root', groupKey: projectGroupKey }),
        ];

        const normalized = normalizeSessionListGroupOrderV1ForSource({
            source,
            pinnedSessionKeysV1: [],
            sessionListGroupOrderV1: {
                [projectGroupKey]: ['s1:root', 'folder:planning', 'folder:missing'],
            },
        });

        expect(normalized).toEqual({
            [projectGroupKey]: ['s1:root', 'folder:planning'],
        });
    });

    it('caps per-group order lists to the configured max', () => {
        const g = 'server:s1:active';
        const source: SessionListViewItem[] = [
            { type: 'header', title: 'Active', headerKind: 'active', groupKey: g, serverId: 's1' },
        ];
        for (let i = 0; i < SESSION_LIST_GROUP_ORDER_MAX_KEYS_PER_GROUP + 10; i++) {
            source.push(makeSessionItem({ serverId: 's1', sessionId: `s${i}`, groupKey: g }));
        }

        const order = source
            .filter((i): i is Extract<SessionListViewItem, { type: 'session' }> => i.type === 'session')
            .map((i) => `s1:${i.session.id}`);

        const normalized = normalizeSessionListGroupOrderV1ForSource({
            source,
            pinnedSessionKeysV1: [],
            sessionListGroupOrderV1: { [g]: order },
        });

        expect(normalized[g]).toHaveLength(SESSION_LIST_GROUP_ORDER_MAX_KEYS_PER_GROUP);
        expect(normalized[g][0]).toBe('s1:s0');
    });

    it('prunes pinned group ordering keys to only pinned sessions that exist in the source', () => {
        const g = 'server:s1:day:2026-02-17';
        const source: SessionListViewItem[] = [
            { type: 'header', title: 'Today', headerKind: 'date', groupKey: g, serverId: 's1' },
            makeSessionItem({ serverId: 's1', sessionId: 'a', groupKey: g }),
            makeSessionItem({ serverId: 's1', sessionId: 'b', groupKey: g }),
        ];

        const normalized = normalizeSessionListGroupOrderV1ForSource({
            source,
            pinnedSessionKeysV1: ['s1:a'],
            sessionListGroupOrderV1: { [PINNED_GROUP_KEY_V1]: ['s1:b', 's1:a', 's1:missing'] },
        });

        expect(normalized).toEqual({ [PINNED_GROUP_KEY_V1]: ['s1:a'] });
    });

    it('preserves dormant ordinary session keys while normalizing structural folder keys', () => {
        const projectGroupKey = 'server:s1:project:abc123';
        const folderGroupKey = `${projectGroupKey}:folder:planning`;
        const source: SessionListViewItem[] = [
            { type: 'header', title: 'Repo', headerKind: 'project', groupKey: projectGroupKey, serverId: 's1' },
            {
                type: 'header',
                title: 'Planning',
                headerKind: 'folder',
                groupKey: folderGroupKey,
                folderId: 'planning',
                parentFolderId: null,
                depth: 1,
                serverId: 's1',
            },
            makeSessionItem({ serverId: 's1', sessionId: 'root', groupKey: projectGroupKey }),
        ];

        const normalized = normalizeSessionListGroupOrderV1ForStructuralSource({
            source,
            pinnedSessionKeysV1: [],
            sessionListGroupOrderV1: {
                [projectGroupKey]: ['s1:missing', 'folder:missing', 's1:root', 'folder:planning'],
            },
        });

        expect(normalized).toEqual({
            [projectGroupKey]: ['s1:missing', 's1:root', 'folder:planning'],
        });
    });

    it('does not cap dormant ordinary session keys while normalizing structural keys', () => {
        const g = 'server:s1:active';
        const source: SessionListViewItem[] = [
            { type: 'header', title: 'Active', headerKind: 'active', groupKey: g, serverId: 's1' },
        ];
        const dormantSessionKeys = Array.from(
            { length: SESSION_LIST_GROUP_ORDER_MAX_KEYS_PER_GROUP + 5 },
            (_, index) => `s1:dormant-${index}`,
        );

        const normalized = normalizeSessionListGroupOrderV1ForStructuralSource({
            source,
            pinnedSessionKeysV1: [],
            sessionListGroupOrderV1: {
                [g]: [...dormantSessionKeys, 'folder:missing'],
            },
        });

        expect(normalized[g]).toEqual(dormantSessionKeys);
    });
});
