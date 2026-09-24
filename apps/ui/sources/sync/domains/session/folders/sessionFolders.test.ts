import { describe, expect, it } from 'vitest';

import {
    SESSION_FOLDER_MAX_NAME_LENGTH,
    buildSessionFolderAssignmentKey,
    buildSessionFolderCollapseKey,
    buildSessionFolderTree,
    compareSessionFolderWorkspaceRefs,
    createSessionFolder,
    deleteSessionFolder,
    moveSessionFolder,
    normalizeSessionFolderName,
    normalizeSessionFolders,
    resolveDurableWorkspaceRefForSessionListHeader,
    resolveSessionFolderDragIntent,
    resolveSessionFolderFocusScope,
    SessionFoldersV1Schema,
} from './index';
import type { SessionFolderV1, SessionFoldersV1, SessionFolderWorkspaceRefV1 } from './types';

const workspaceA: SessionFolderWorkspaceRefV1 = {
    t: 'workspaceScope',
    serverId: 'server-a',
    machineId: 'machine-a',
    rootPath: '/Users/lee/project',
};

const workspaceB: SessionFolderWorkspaceRefV1 = {
    t: 'workspaceScope',
    serverId: 'server-a',
    machineId: 'machine-a',
    rootPath: '/Users/lee/other',
};

function folder(overrides: Partial<SessionFolderV1>): SessionFolderV1 {
    return {
        id: 'folder-a',
        workspace: workspaceA,
        renderWorkspaceKey: 'wl_old',
        parentId: null,
        name: 'Folder',
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

describe('session folder domain helpers', () => {
    it('normalizes folder names for persisted records', () => {
        expect(normalizeSessionFolderName('  Alpha\nBeta  ')).toBe('Alpha Beta');
        expect(normalizeSessionFolderName('x'.repeat(SESSION_FOLDER_MAX_NAME_LENGTH + 10))).toHaveLength(SESSION_FOLDER_MAX_NAME_LENGTH);
        expect(normalizeSessionFolderName('   ')).toBeNull();
    });

    it('uses the shared protocol schema for persisted folder settings', () => {
        const parsed = SessionFoldersV1Schema.safeParse({
            v: 1,
            folders: [
                folder({
                    name: 'x'.repeat(SESSION_FOLDER_MAX_NAME_LENGTH + 1),
                }),
            ],
        });

        expect(parsed.success).toBe(false);
    });

    it('keeps folder ownership durable when render workspace keys change', () => {
        const setting: SessionFoldersV1 = {
            v: 1,
            folders: [
                folder({ id: 'root', renderWorkspaceKey: 'wl_old' }),
            ],
        };

        const normalized = normalizeSessionFolders(setting, {
            currentRenderWorkspaceKeysByFolderId: { root: 'wl_new' },
        });

        expect(normalized.folders[0]).toMatchObject({
            id: 'root',
            renderWorkspaceKey: 'wl_new',
        });
        expect(compareSessionFolderWorkspaceRefs(normalized.folders[0]!.workspace, workspaceA)).toBe(true);
    });

    it('isolates siblings by durable workspace while normalizing duplicate names', () => {
        const normalized = normalizeSessionFolders({
            v: 1,
            folders: [
                folder({ id: 'a', name: 'Inbox' }),
                folder({ id: 'b', name: ' inbox ' }),
                folder({ id: 'c', name: 'Inbox', workspace: workspaceB }),
            ],
        });

        expect(normalized.folders.map((item) => item.name)).toEqual(['Inbox', 'inbox 2', 'Inbox']);
    });

    it('migrates legacy padded sort keys to fractional keys per sibling group on read', () => {
        const normalized = normalizeSessionFolders({
            v: 1,
            folders: [
                folder({ id: 'root-a', sortKey: '000001' }),
                folder({ id: 'root-b', sortKey: '000002' }),
                folder({ id: 'child-a', parentId: 'root-a', sortKey: '000001' }),
                folder({ id: 'workspace-b-root', workspace: workspaceB, sortKey: '000001' }),
            ],
        });

        const byId = new Map(normalized.folders.map((item) => [item.id, item] as const));
        expect(byId.get('root-a')?.sortKey).not.toBe('000001');
        expect(byId.get('root-b')?.sortKey).not.toBe('000002');
        expect(byId.get('child-a')?.sortKey).not.toBe('000001');
        expect(byId.get('workspace-b-root')?.sortKey).not.toBe('000001');
        expect(buildSessionFolderTree(normalized, workspaceA).rootNodes.map((node) => node.id))
            .toEqual(['root-a', 'root-b']);
    });

    it('drops orphan parents and breaks cycles defensively', () => {
        const normalized = normalizeSessionFolders({
            v: 1,
            folders: [
                folder({ id: 'orphan', parentId: 'missing' }),
                folder({ id: 'a', parentId: 'b' }),
                folder({ id: 'b', parentId: 'a' }),
            ],
        });

        expect(normalized.folders.find((item) => item.id === 'orphan')?.parentId).toBeNull();
        expect(normalized.folders.filter((item) => item.parentId === null).map((item) => item.id).sort()).toContain('a');
    });

    it('builds tree breadcrumbs and focused subtree scope', () => {
        const normalized = normalizeSessionFolders({
            v: 1,
            folders: [
                folder({ id: 'root', name: 'Root' }),
                folder({ id: 'child', name: 'Child', parentId: 'root' }),
                folder({ id: 'grandchild', name: 'Grandchild', parentId: 'child' }),
            ],
        });

        const tree = buildSessionFolderTree(normalized, workspaceA);
        const focus = resolveSessionFolderFocusScope(normalized, {
            folderId: 'child',
            workspace: workspaceA,
            serverId: 'server-a',
        });

        expect(tree.rootNodes.map((node) => node.id)).toEqual(['root']);
        expect(focus?.folderIds).toEqual(new Set(['child', 'grandchild']));
        expect(focus?.breadcrumbs.map((crumb) => crumb.name)).toEqual(['Root', 'Child']);
    });

    it('creates and deletes folders with replacement assignment targets', () => {
        const created = createSessionFolder({
            current: { v: 1, folders: [] },
            workspace: workspaceA,
            renderWorkspaceKey: 'wl_a',
            parentId: null,
            name: 'New folder',
            now: 10,
            id: 'new',
        });

        expect(created.folder.name).toBe('New folder');
        expect(created.next.folders).toHaveLength(1);

        const deleted = deleteSessionFolder({
            current: {
                v: 1,
                folders: [
                    folder({ id: 'parent', name: 'Parent' }),
                    folder({ id: 'child', name: 'Child', parentId: 'parent' }),
                ],
            },
            folderId: 'child',
        });

        expect(deleted.deletedFolderIds).toEqual(['child']);
        expect(deleted.replacementFolderId).toBe('parent');
        expect(deleted.next.folders.map((item) => item.id)).toEqual(['parent']);
    });

    it('moves folders between workspace root and subfolders without cycles', () => {
        const current: SessionFoldersV1 = {
            v: 1,
            folders: [
                folder({ id: 'parent', name: 'Parent' }),
                folder({ id: 'child', name: 'Child', parentId: 'parent' }),
                folder({ id: 'sibling', name: 'Sibling' }),
            ],
        };

        const movedToSibling = moveSessionFolder({
            current,
            folderId: 'child',
            parentId: 'sibling',
            now: 20,
        });
        expect(movedToSibling.folder).toMatchObject({ id: 'child', parentId: 'sibling', updatedAt: 20 });

        const movedToRoot = moveSessionFolder({
            current: movedToSibling.next,
            folderId: 'child',
            parentId: null,
            now: 30,
        });
        expect(movedToRoot.folder).toMatchObject({ id: 'child', parentId: null, updatedAt: 30 });

        const rejectedCycle = moveSessionFolder({
            current,
            folderId: 'parent',
            parentId: 'child',
            now: 40,
        });
        expect(rejectedCycle.folder).toBeNull();
        expect(rejectedCycle.next).toBe(current);
    });

    it('moves folders before a sibling and persists sibling order with sort keys', () => {
        const current: SessionFoldersV1 = {
            v: 1,
            folders: [
                folder({ id: 'parent', name: 'Parent' }),
                folder({ id: 'child', name: 'Child', parentId: 'parent' }),
                folder({ id: 'alpha', name: 'Alpha' }),
                folder({ id: 'zulu', name: 'Zulu' }),
            ],
        };

        const moved = moveSessionFolder({
            current,
            folderId: 'child',
            parentId: null,
            beforeFolderId: 'alpha',
            now: 50,
        });

        expect(moved.folder).toMatchObject({ id: 'child', parentId: null, updatedAt: 50 });
        expect(buildSessionFolderTree(moved.next, workspaceA).rootNodes.map((node) => node.id))
            .toEqual(['parent', 'child', 'alpha', 'zulu']);
    });

    it('moves a folder before a sibling without rewriting unchanged sibling sort keys', () => {
        const current: SessionFoldersV1 = {
            v: 1,
            folders: [
                folder({ id: 'parent', name: 'Parent', sortKey: 'a0', updatedAt: 10 }),
                folder({ id: 'child', name: 'Child', parentId: 'parent', sortKey: 'a0', updatedAt: 11 }),
                folder({ id: 'alpha', name: 'Alpha', sortKey: 'a1', updatedAt: 12 }),
                folder({ id: 'zulu', name: 'Zulu', sortKey: 'a2', updatedAt: 13 }),
            ],
        };

        const moved = moveSessionFolder({
            current,
            folderId: 'child',
            parentId: null,
            beforeFolderId: 'alpha',
            now: 50,
        });

        const foldersById = new Map(moved.next.folders.map((item) => [item.id, item] as const));
        expect(foldersById.get('alpha')).toMatchObject({ sortKey: 'a1', updatedAt: 12 });
        expect(foldersById.get('zulu')).toMatchObject({ sortKey: 'a2', updatedAt: 13 });
        expect(foldersById.get('child')).toMatchObject({ parentId: null, updatedAt: 50 });
        expect(foldersById.get('child')?.sortKey).not.toBe('a0');
        expect(buildSessionFolderTree(moved.next, workspaceA).rootNodes.map((node) => node.id))
            .toEqual(['parent', 'child', 'alpha', 'zulu']);
    });

    it('builds durable collapse and assignment keys', () => {
        expect(buildSessionFolderAssignmentKey('server-a', 'session-a')).toBe('server-a:session-a');
        expect(buildSessionFolderCollapseKey({ serverId: 'server-a', workspace: workspaceA, folderId: 'folder-a' }))
            .toBe('folder:server-a:workspaceScope:server-a:machine-a:/Users/lee/project:folder-a');
    });

    it('resolves durable workspace refs from project headers without persisting render keys alone', () => {
        const ref = resolveDurableWorkspaceRefForSessionListHeader({
            type: 'header',
            title: 'Project',
            serverId: 'server-a',
            workspaceKey: 'wl_hash',
            workspaceScopeHint: {
                serverId: 'server-a',
                machineId: 'machine-a',
                rootPath: 'C:\\Users\\Lee\\repo\\',
            },
        });

        expect(ref).toEqual({
            t: 'workspaceScope',
            serverId: 'server-a',
            machineId: 'machine-a',
            rootPath: 'c:/users/lee/repo',
        });
    });

    it('resolves drag/drop assignment intents without mixing reorder intent', () => {
        expect(resolveSessionFolderDragIntent({
            draggedSessionId: 's1',
            target: { type: 'folder', folderId: 'folder-a' },
        })).toEqual({ type: 'assign', sessionId: 's1', folderId: 'folder-a' });

        expect(resolveSessionFolderDragIntent({
            draggedSessionId: 's1',
            target: { type: 'workspace-root' },
        })).toEqual({ type: 'unassign', sessionId: 's1' });

        expect(resolveSessionFolderDragIntent({
            draggedSessionId: 's1',
            target: { type: 'reorder', beforeSessionId: 's2' },
        })).toEqual({ type: 'reorder', sessionId: 's1', beforeSessionId: 's2' });
    });
});
