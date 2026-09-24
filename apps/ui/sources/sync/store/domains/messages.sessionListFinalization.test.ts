import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionListViewItem } from '../../domains/session/listing/sessionListViewData';
import type { SessionListRenderableSession } from '../../domains/session/listing/sessionListRenderable';

function createSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 's1',
        seq: 10,
        createdAt: 1_000,
        updatedAt: 2_000,
        active: false,
        activeAt: 2_000,
        archivedAt: null,
        lastViewedSessionSeq: 9,
        metadata: {
            machineId: 'm1',
            path: '/home/u/repo',
            homeDir: '/home/u',
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 1_500,
        presence: 2_000,
        latestTurnStatus: 'completed',
        latestTurnStatusObservedAt: 2_000,
        permissionMode: null,
        permissionModeUpdatedAt: 0,
        ...overrides,
    };
}

function createWorkingRenderable(overrides: Partial<SessionListRenderableSession> = {}): SessionListRenderableSession {
    return {
        id: 's1',
        seq: 9,
        createdAt: 1_000,
        updatedAt: 1_900,
        active: true,
        activeAt: 1_900,
        archivedAt: null,
        lastViewedSessionSeq: 9,
        metadata: {
            machineId: 'm1',
            path: '/home/u/repo',
            homeDir: '/home/u',
        },
        metadataVersion: 1,
        agentStateVersion: 0,
        thinking: true,
        thinkingAt: Date.now(),
        presence: 'online',
        latestTurnStatus: 'in_progress',
        latestTurnStatusObservedAt: 1_900,
        latestReadyEventSeq: null,
        latestReadyEventAt: null,
        ...overrides,
    };
}

const serverProfiles = vi.hoisted(() => ({
    activeServerId: 'server_1',
    profiles: [] as Array<{
        id: string;
        name: string;
        serverUrl: string;
        serverIdentityId: string | null;
        legacyServerIds: string[];
        createdAt: number;
        updatedAt: number;
        lastUsedAt: number;
    }>,
}));

function readPromotedSession(data: readonly SessionListViewItem[] | null): Extract<SessionListViewItem, { type: 'session' }> | null {
    return (data ?? []).find((item): item is Extract<SessionListViewItem, { type: 'session' }> =>
        item.type === 'session' && item.session.id === 's1'
    ) ?? null;
}

async function createHarness(params: Readonly<{
    lastViewedSessionSeq?: number;
    activeServerId?: string;
    sessionServerId?: string;
}>) {
    const activeServerId = params.activeServerId ?? 'server_1';
    const sessionServerId = params.sessionServerId ?? activeServerId;
    serverProfiles.activeServerId = activeServerId;
    serverProfiles.profiles = Array.from(new Set([activeServerId, sessionServerId])).map((serverId) => ({
        id: serverId,
        name: serverId === 'server_1' ? 'Server One' : `Server ${serverId}`,
        serverUrl: 'http://server.test',
        serverIdentityId: null,
        legacyServerIds: [],
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: 1,
    }));
    vi.doMock('../../domains/server/serverRuntime', () => ({
        getActiveServerSnapshot: vi.fn(() => ({
            serverId: activeServerId,
            serverUrl: 'http://server.test',
            generation: 1,
        })),
    }));
    vi.doMock('../../domains/server/serverProfiles', async (importOriginal) => {
        const { createServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
        return createServerProfilesModuleMock({
            importOriginal,
            overrides: {
                getActiveServerSnapshot: vi.fn(() => ({
                    serverId: serverProfiles.activeServerId,
                    serverUrl: 'http://server.test',
                    generation: 1,
                })),
                listServerProfiles: vi.fn(() => serverProfiles.profiles),
            },
        });
    });

    const { createMessagesDomain } = await import('./messages');
    const { buildSessionListViewDataWithServerScope } = await import('../buildSessionListViewDataWithServerScope');
    const { buildSessionListIndexFromViewData } = await import('../../domains/session/listing/sessionListIndex');
    const { computeVisibleSessionListIndex } = await import('../../domains/session/listing/computeVisibleSessionListIndex');
    const { buildSessionListViewDataFromIndex } = await import('../../domains/session/listing/sessionListViewDataFromIndex');

    const session = createSession({
        serverId: sessionServerId,
        lastViewedSessionSeq: params.lastViewedSessionSeq ?? 9,
    });
    const workingRenderable = createWorkingRenderable({
        lastViewedSessionSeq: params.lastViewedSessionSeq ?? 9,
    });
    const initialListViewData = buildSessionListViewDataWithServerScope({
        sessions: { s1: workingRenderable },
        sessionRecords: { s1: session as any },
        machines: {},
        machineRecords: {},
        groupInactiveSessionsByProject: false,
        inactiveGroupingV1: 'date',
    });
    const activeListViewData = activeServerId === sessionServerId ? initialListViewData : [];

    let state: any = {
        sessions: { s1: session },
        sessionPending: {},
        sessionMessages: {},
        sessionListRenderables: { s1: workingRenderable },
        sessionListViewData: activeListViewData,
        sessionListViewDataByServerId: {
            [activeServerId]: activeListViewData,
            [sessionServerId]: initialListViewData,
        },
        machines: {},
        machineDisplayById: {},
        settings: {
            sessionListAttentionPromotionModeV1: 'global',
            sessionListWorkingPlacementModeV1: 'global',
            groupInactiveSessionsByProject: false,
            sessionListInactiveGroupingV1: 'date',
        },
    };

    const get = () => state;
    const set = (updater: any) => {
        const next = typeof updater === 'function' ? updater(state) : updater;
        state = { ...state, ...next };
    };
    const domain = createMessagesDomain({ get, set } as any);

    const buildVisibleList = (data: readonly SessionListViewItem[] | null): SessionListViewItem[] | null => {
        const sourceIndex = buildSessionListIndexFromViewData(data);
        const visibleIndex = computeVisibleSessionListIndex({
            source: sourceIndex,
            resolveSessionRow: (serverId, sessionId) => {
                const key = `${String(serverId ?? '').trim()}:${String(sessionId ?? '').trim()}`;
                if (key !== `${sessionServerId}:s1`) return null;
                return readPromotedSession(data)?.session ?? null;
            },
            hideInactiveSessions: false,
            pinnedSessionKeysV1: [],
            sessionListGroupOrderV1: {},
            presentation: {
                enabled: false,
                presentation: 'flat-with-badge',
            },
            attentionPromotion: { mode: 'global' },
            workingPlacement: { mode: 'global' },
        });
        return buildSessionListViewDataFromIndex({
            index: visibleIndex,
            source: data,
            sourceIndex,
        });
    };

    return { domain, get, initialListViewData, activeListViewData, buildVisibleList };
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe('messages domain: session list finalization', () => {
    it('moves a working row to attention when applyMessages receives an unread ready event', async () => {
        const { domain, get, initialListViewData, buildVisibleList } = await createHarness({});

        const initialVisible = buildVisibleList(initialListViewData);
        expect(readPromotedSession(initialVisible)?.groupKind).toBe('working');

        domain.applyMessages('s1', [{
            id: 'ready-10',
            seq: 10,
            localId: null,
            createdAt: 2_100,
            isSidechain: false,
            role: 'event',
            content: { type: 'ready' },
        } as any]);

        expect(get().sessionListViewData).not.toBe(initialListViewData);
        expect(get().sessionListViewDataByServerId.server_1).toBe(get().sessionListViewData);
        const visible = buildVisibleList(get().sessionListViewData);
        const session = readPromotedSession(visible);
        expect(session?.groupKind).toBe('attention');
        expect(session?.attentionPromotionReason).toBe('ready');
        expect(session?.session.latestReadyEventSeq).toBe(10);
    });

    it('writes ready metadata into hydrated session state when ready is the only session-level change', async () => {
        const { domain, get } = await createHarness({});

        domain.applyMessages('s1', [{
            id: 'ready-10',
            seq: 10,
            localId: null,
            createdAt: 2_100,
            isSidechain: false,
            role: 'event',
            content: { type: 'ready' },
        } as any]);

        expect(get().sessions.s1.latestReadyEventSeq).toBe(10);
        expect(get().sessions.s1.latestReadyEventAt).toBe(2_100);
    });

    it('does not move a ready event covered by the read cursor into attention', async () => {
        const { domain, get, buildVisibleList } = await createHarness({ lastViewedSessionSeq: 10 });

        domain.applyMessages('s1', [{
            id: 'ready-10',
            seq: 10,
            localId: null,
            createdAt: 2_100,
            isSidechain: false,
            role: 'event',
            content: { type: 'ready' },
        } as any]);

        const visible = buildVisibleList(get().sessionListViewData);
        const session = readPromotedSession(visible);
        expect(session?.groupKind).not.toBe('attention');
        expect(session?.attentionPromotionReason).toBeUndefined();
        expect(session?.session.latestReadyEventSeq).toBe(10);
    });

    it('rebuilds the owning server cache when a ready event arrives for a non-active server session', async () => {
        const {
            domain,
            get,
            initialListViewData,
            activeListViewData,
            buildVisibleList,
        } = await createHarness({
            activeServerId: 'server_active',
            sessionServerId: 'server_target',
        });

        domain.applyMessages('s1', [{
            id: 'ready-10',
            seq: 10,
            localId: null,
            createdAt: 2_100,
            isSidechain: false,
            role: 'event',
            content: { type: 'ready' },
        } as any]);

        expect(get().sessionListViewData).toBe(activeListViewData);
        expect(get().sessionListViewDataByServerId.server_active).toBe(activeListViewData);
        expect(get().sessionListViewDataByServerId.server_target).not.toBe(initialListViewData);
        const visible = buildVisibleList(get().sessionListViewDataByServerId.server_target);
        const session = readPromotedSession(visible);
        expect(session?.groupKind).toBe('attention');
        expect(session?.attentionPromotionReason).toBe('ready');
        expect(session?.session.latestReadyEventSeq).toBe(10);
    });
});
