import { describe, expect, it } from 'vitest';
import type { SessionListViewItem } from './sessionListViewData';
import type { SessionListRenderableSession } from './sessionListRenderable';
import { filterSessionListViewDataByStatus } from './filterSessionListViewDataByStatus';

/** 合成列表行保留真实状态投影所需字段，不读取账号。 */
function row(id: string, overrides: Partial<SessionListRenderableSession> = {}): Extract<SessionListViewItem, { type: 'session' }> {
    return { type: 'session', serverId: 'server-a', session: { id, seq: 1, createdAt: 1, updatedAt: 1, active: false, activeAt: 0, metadataVersion: 1, agentStateVersion: 1, metadata: null, thinking: false, thinkingAt: 0, presence: 0, ...overrides } };
}
const now = 200_000;
const working = row('working', { latestTurnStatus: 'in_progress', latestTurnStatusObservedAt: now - 1000 });
const stale = row('stale', { latestTurnStatus: 'in_progress', latestTurnStatusObservedAt: 1 });
const blocked = row('blocked', { pendingBlockedCount: 1 });

describe('phone session status filter', () => {
    it('keeps all as the same array and keeps original row references', () => {
        const source = [working, stale];
        expect(filterSessionListViewDataByStatus(source, 'all', now)).toBe(source);
        expect(filterSessionListViewDataByStatus(source, 'working', now)).toEqual([working]);
        expect(filterSessionListViewDataByStatus(source, 'working', now)[0]).toBe(working);
    });
    it('expires working from canonical time without retaining paused or unknown rows', () => {
        expect(filterSessionListViewDataByStatus([working, stale, row('unknown')], 'working', now + 120_000)).toEqual([]);
    });
    it('does not count offline stale legacy thinking as running', () => {
        expect(filterSessionListViewDataByStatus([row('offline', { thinking: true, thinkingAt: now, presence: 0 })], 'working', now)).toEqual([]);
    });
    it('keeps fresh permission and user-action requests and expires stale requests', () => {
        const permission = row('permission', { hasPendingPermissionRequests: true, pendingRequestObservedAt: now - 1000, active: true, activeAt: now, presence: 'online' });
        const action = row('action', { hasPendingUserActionRequests: true, pendingRequestObservedAt: now - 1000, active: true, activeAt: now, presence: 'online' });
        expect(filterSessionListViewDataByStatus([permission, action], 'attention', now)).toEqual([permission, action]);
        expect(filterSessionListViewDataByStatus([permission, action], 'attention', now + 120_000)).toEqual([]);
    });
    it('keeps requests needing action but not unread or completed sessions', () => {
        expect(filterSessionListViewDataByStatus([blocked, row('unread', { hasUnreadMessages: true }), row('done', { latestTurnStatus: 'completed' })], 'attention', now)).toEqual([blocked]);
    });
    it('does not keep child folders for a parent or root session emitted after the child tree', () => {
        const parent: SessionListViewItem = { type: 'header', title: 'Parent', headerKind: 'folder', depth: 0 };
        const child: SessionListViewItem = { type: 'header', title: 'Empty child', headerKind: 'folder', depth: 1 };
        const parentRow = { ...working, folderId: 'parent', folderDepth: 1 };
        const rootRow = { ...working, folderId: null, folderDepth: 0 };
        expect(filterSessionListViewDataByStatus([parent, child, stale, parentRow], 'working', now)).toEqual([parent, parentRow]);
        expect(filterSessionListViewDataByStatus([parent, child, stale, rootRow], 'working', now)).toEqual([rootRow]);
    });
    it('excludes a stale row retained in a working group', () => {
        const retained: SessionListViewItem = { ...stale, workingPlacementReason: 'working-retained' } as SessionListViewItem;
        expect(filterSessionListViewDataByStatus([retained], 'working', now)).toEqual([]);
    });
    it('removes empty section and sibling folder headers but retains matched ancestry', () => {
        const section: SessionListViewItem = { type: 'header', title: 'Sessions', headerKind: 'sessions' };
        const parent: SessionListViewItem = { type: 'header', title: 'Parent', headerKind: 'folder', depth: 0 };
        const empty: SessionListViewItem = { type: 'header', title: 'Empty', headerKind: 'folder', depth: 1 };
        const sibling: SessionListViewItem = { type: 'header', title: 'Match', headerKind: 'folder', depth: 1 };
        expect(filterSessionListViewDataByStatus([section, parent, empty, stale, sibling, working], 'working', now)).toEqual([section, parent, sibling, working]);
        expect(filterSessionListViewDataByStatus([section, parent, empty, stale], 'attention', now)).toEqual([]);
    });
});
