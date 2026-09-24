import { describe, expect, it, vi } from 'vitest';

import type { TreeDropResult, WindowBounds } from '@/components/ui/treeDragDrop';
import type { SessionListIndexItem } from '@/sync/domains/session/listing/sessionListIndex';
import type { SessionFolderWorkspaceRefV1, SessionFoldersV1 } from '@/sync/domains/session/folders';

import { applySessionListTreeDropOperation } from './commit/applySessionListTreeDropOperation';
import { commitSessionListDragIntent } from './drag/commitSessionListDragIntent';
import type { SessionListDragIntent } from './drag/_types';
import { buildSessionListDragSource } from './drop-resolution/buildSessionListDragSource';
import { buildSessionListTreeRows } from './drop-resolution/buildSessionListTreeRows';
import { resolveSessionListInstruction } from './drop-resolution/resolveSessionListInstruction';
import { treeRowId } from './drop-resolution/treeRowId';

const workspaceA: SessionFolderWorkspaceRefV1 = {
    t: 'workspaceScope',
    serverId: 'server-a',
    machineId: 'machine-a',
    rootPath: '/repo/a',
};

const workspaceB: SessionFolderWorkspaceRefV1 = {
    t: 'workspaceScope',
    serverId: 'server-a',
    machineId: 'machine-b',
    rootPath: '/repo/b',
};

function bounds(y: number): WindowBounds {
    return { x: 0, y, width: 320, height: 40 };
}

function projectHeader(groupKey: string, workspace: SessionFolderWorkspaceRefV1): Extract<SessionListIndexItem, { type: 'header' }> {
    return {
        type: 'header',
        title: groupKey,
        headerKind: 'project',
        groupKey,
        workspaceKey: groupKey,
        workspace,
        serverId: 'server-a',
    };
}

function folderHeader(params: Readonly<{
    id: string;
    groupKey: string;
    depth: number;
    workspace: SessionFolderWorkspaceRefV1;
}>): Extract<SessionListIndexItem, { type: 'header' }> {
    return {
        type: 'header',
        title: params.id,
        headerKind: 'folder',
        folderId: params.id,
        folderDepth: params.depth,
        groupKey: params.groupKey,
        workspace: params.workspace,
        serverId: 'server-a',
    };
}

function sessionItem(params: Readonly<{
    id: string;
    groupKey: string;
    folderId: string | null;
    depth: number;
    workspace: SessionFolderWorkspaceRefV1;
}>): Extract<SessionListIndexItem, { type: 'session' }> {
    return {
        type: 'session',
        sessionId: params.id,
        serverId: 'server-a',
        storageKind: 'persisted',
        groupKey: params.groupKey,
        groupKind: params.folderId ? 'folder' : 'project',
        folderId: params.folderId,
        folderDepth: params.depth,
        workspace: params.workspace,
    };
}

function items(): SessionListIndexItem[] {
    return [
        projectHeader('project-a', workspaceA),
        folderHeader({ id: 'folder-a', groupKey: 'project-a:folder:folder-a', depth: 0, workspace: workspaceA }),
        sessionItem({ id: 'inside-a', groupKey: 'project-a:folder:folder-a', folderId: 'folder-a', depth: 1, workspace: workspaceA }),
        folderHeader({ id: 'child-a', groupKey: 'project-a:folder:child-a', depth: 1, workspace: workspaceA }),
        folderHeader({ id: 'folder-b', groupKey: 'project-a:folder:folder-b', depth: 0, workspace: workspaceA }),
        sessionItem({ id: 'root-a', groupKey: 'project-a', folderId: null, depth: 0, workspace: workspaceA }),
        projectHeader('project-b', workspaceB),
        folderHeader({ id: 'folder-c', groupKey: 'project-b:folder:folder-c', depth: 0, workspace: workspaceB }),
    ];
}

function folders(): SessionFoldersV1 {
    return {
        v: 1,
        folders: [
            { id: 'folder-a', workspace: workspaceA, parentId: null, name: 'A', createdAt: 1, updatedAt: 1, sortKey: '000001' },
            { id: 'child-a', workspace: workspaceA, parentId: 'folder-a', name: 'A child', createdAt: 2, updatedAt: 2, sortKey: '000001' },
            { id: 'folder-b', workspace: workspaceA, parentId: null, name: 'B', createdAt: 3, updatedAt: 3, sortKey: '000002' },
            { id: 'folder-c', workspace: workspaceB, parentId: null, name: 'C', createdAt: 4, updatedAt: 4, sortKey: '000001' },
        ],
    };
}

function buildTree() {
    return buildSessionListTreeRows({
        items: items(),
        rowBoundsById: new Map([
            [treeRowId.workspaceRoot('project-a'), bounds(0)],
            [treeRowId.folder('folder-a'), bounds(40)],
            [treeRowId.session('server-a', 'inside-a'), bounds(80)],
            [treeRowId.folder('child-a'), bounds(120)],
            [treeRowId.folder('folder-b'), bounds(160)],
            [treeRowId.session('server-a', 'root-a'), bounds(200)],
            [treeRowId.workspaceRoot('project-b'), bounds(300)],
            [treeRowId.folder('folder-c'), bounds(340)],
        ]),
        dropZoneBounds: [
            {
                containerId: treeRowId.workspaceRoot('project-a'),
                role: 'root-before-first',
                bounds: { x: 0, y: 20, width: 320, height: 16 },
            },
            {
                containerId: treeRowId.workspaceRoot('project-a'),
                role: 'root-after-last',
                bounds: { x: 0, y: 244, width: 320, height: 16 },
            },
            {
                containerId: treeRowId.folder('folder-b'),
                role: 'container-body',
                bounds: { x: 0, y: 164, width: 320, height: 24 },
            },
        ],
    });
}

function expectVisualToMatchInstruction(result: TreeDropResult): void {
    const { instruction, visual } = result;
    if (instruction.kind === 'reorder-before' || instruction.kind === 'reorder-after') {
        expect(visual).toEqual({
            kind: 'line',
            targetId: instruction.targetId,
            edge: instruction.kind === 'reorder-before' ? 'top' : 'bottom',
            depth: instruction.depth,
        });
        return;
    }
    if (instruction.kind === 'nest-into') {
        expect(visual).toEqual({ kind: 'outline', targetId: instruction.targetId });
        return;
    }
    if (instruction.kind === 'move-to-root') {
        expect(visual.kind).not.toBe('outline');
        if (visual.kind === 'line') {
            expect(visual.targetId).toBe(instruction.containerId);
            expect(visual.depth).toBe(instruction.depth);
        }
        return;
    }
    expect(visual).toEqual({ kind: 'none' });
}

type DragConsistencyScenario = Readonly<{
    name: string;
    sourceRowId: string;
    y: number;
    contextOrderingMode?: 'custom' | 'created' | 'updated';
    expectedAssignment?: Readonly<{ serverId: string; sessionId: string; folderId: string | null }>;
    expectedOrder?: Readonly<Record<string, readonly string[]>> | false;
    expectedFolderParent?: Readonly<{ folderId: string; parentId: string | null }>;
    expectedBlocked?: boolean;
}>;

describe('SessionsList drag result consistency', () => {
    it.each([
        {
            name: 'session into sibling folder',
            sourceRowId: treeRowId.session('server-a', 'inside-a'),
            y: 180,
            expectedAssignment: { serverId: 'server-a', sessionId: 'inside-a', folderId: 'folder-b' },
            expectedOrder: { 'project-a:folder:folder-b': ['server-a:inside-a'] },
        },
        {
            name: 'session out to workspace root',
            sourceRowId: treeRowId.session('server-a', 'inside-a'),
            y: 250,
            expectedAssignment: { serverId: 'server-a', sessionId: 'inside-a', folderId: null },
            expectedOrder: { 'project-a': ['folder:folder-a', 'folder:folder-b', 'server-a:root-a', 'server-a:inside-a'] },
        },
        {
            name: 'date-mode session into sibling folder',
            sourceRowId: treeRowId.session('server-a', 'inside-a'),
            y: 180,
            contextOrderingMode: 'updated',
            expectedAssignment: { serverId: 'server-a', sessionId: 'inside-a', folderId: 'folder-b' },
            expectedOrder: false,
        },
        {
            name: 'date-mode session out to workspace root',
            sourceRowId: treeRowId.session('server-a', 'inside-a'),
            y: 250,
            contextOrderingMode: 'updated',
            expectedAssignment: { serverId: 'server-a', sessionId: 'inside-a', folderId: null },
            expectedOrder: false,
        },
        {
            name: 'folder around root sessions',
            sourceRowId: treeRowId.folder('folder-b'),
            y: 204,
            expectedOrder: { 'project-a': ['folder:folder-a', 'folder:folder-b', 'server-a:root-a'] },
        },
        {
            name: 'date-mode folder sibling reorder',
            sourceRowId: treeRowId.folder('folder-b'),
            y: 204,
            contextOrderingMode: 'created',
            expectedOrder: { 'project-a': ['folder:folder-a', 'folder:folder-b'] },
        },
        {
            name: 'date-mode folder nesting',
            sourceRowId: treeRowId.folder('folder-a'),
            y: 180,
            contextOrderingMode: 'updated',
            expectedFolderParent: { folderId: 'folder-a', parentId: 'folder-b' },
            expectedOrder: { 'project-a:folder:folder-b': ['folder:folder-a'] },
        },
        {
            name: 'blocked descendant folder target',
            sourceRowId: treeRowId.folder('folder-a'),
            y: 140,
            expectedBlocked: true,
        },
        {
            name: 'blocked cross-workspace target',
            sourceRowId: treeRowId.session('server-a', 'inside-a'),
            y: 360,
            expectedBlocked: true,
        },
    ] satisfies readonly DragConsistencyScenario[])('uses one result for $name', async (scenario) => {
        const tree = buildTree();
        const source = buildSessionListDragSource({ tree, sourceRowId: scenario.sourceRowId });
        const result = resolveSessionListInstruction({
            tree,
            source,
            pointer: { x: 160, y: scenario.y },
            foldersFeatureEnabled: true,
        });

        expectVisualToMatchInstruction(result);

        const setSessionFolderAssignment = vi.fn(async () => undefined);
        const setSessionFoldersV1 = vi.fn();
        const setSessionListGroupOrderV1 = vi.fn();

        const applied = await applySessionListTreeDropOperation({
            tree,
            source,
            result,
            context: {
                sessionFoldersV1: folders(),
                sessionListGroupOrderV1: {},
                sessionListOrderingModeV1: scenario.contextOrderingMode,
                now: () => 100,
                setSessionFoldersV1,
                setSessionListGroupOrderV1,
                setSessionFolderAssignment,
            },
        });

        if (scenario.expectedBlocked) {
            expect(applied.ok).toBe(false);
            expect(setSessionFolderAssignment).not.toHaveBeenCalled();
            expect(setSessionFoldersV1).not.toHaveBeenCalled();
            expect(setSessionListGroupOrderV1).not.toHaveBeenCalled();
            return;
        }

        expect(applied.ok).toBe(true);
        if (scenario.expectedAssignment) {
            expect(setSessionFolderAssignment).toHaveBeenCalledWith(scenario.expectedAssignment);
        }
        if (scenario.expectedFolderParent) {
            expect(setSessionFoldersV1).toHaveBeenCalledTimes(1);
            const nextFolders = setSessionFoldersV1.mock.calls[0]?.[0] as SessionFoldersV1 | undefined;
            const movedFolder = nextFolders?.folders.find((folder) => folder.id === scenario.expectedFolderParent?.folderId);
            expect(movedFolder).toEqual(expect.objectContaining({
                parentId: scenario.expectedFolderParent.parentId,
                updatedAt: 100,
            }));
        }
        if (scenario.expectedOrder === false) {
            expect(setSessionListGroupOrderV1).not.toHaveBeenCalled();
        } else if (scenario.expectedOrder) {
            expect(setSessionListGroupOrderV1).toHaveBeenCalledWith(scenario.expectedOrder);
        }
    });
});

/**
 * Builds the stable `SessionListDragIntent` from a resolved `TreeDropResult` —
 * the same conversion the drop handler performs at drop time. Kept local to the
 * agreement test: it only needs to express that a visual-phase result and the
 * commit-phase intent describe the same move.
 */
function intentFromResult(params: Readonly<{
    result: TreeDropResult;
    sourceRowId: string;
}>): SessionListDragIntent {
    const { instruction } = params.result;
    const targetRowId = instruction.kind === 'reorder-before'
        || instruction.kind === 'reorder-after'
        || instruction.kind === 'nest-into'
        ? instruction.targetId
        : null;
    const containerId = instruction.kind === 'reorder-before'
        || instruction.kind === 'reorder-after'
        || instruction.kind === 'nest-into'
        || instruction.kind === 'move-to-root'
        ? instruction.containerId
        : null;
    const parentRowId = instruction.kind === 'reorder-before'
        || instruction.kind === 'reorder-after'
        || instruction.kind === 'nest-into'
        ? instruction.parentId
        : null;
    return {
        sourceRowId: params.sourceRowId,
        sourceKind: params.sourceRowId.startsWith('session:') ? 'leaf' : 'container',
        instructionKind: instruction.kind,
        targetRowId,
        containerId,
        parentRowId,
        depth: instruction.kind === 'idle' || instruction.kind === 'blocked' ? null : instruction.depth,
        edge: params.result.visual.kind === 'line' ? params.result.visual.edge : null,
        rootPlacement: instruction.kind === 'move-to-root' ? instruction.placement : null,
        sourceSnapshotSignature: 'agreement-snapshot',
    };
}

describe('SessionsList drag visual/commit agreement under mid-drag mutation', () => {
    it('commits the same target the visual resolved even after a background reorder', async () => {
        // Visual phase: resolve "move inside-a out, after root-a" from the
        // snapshot tree. The line visual targets root-a's bottom edge.
        const snapshotTree = buildTree();
        const sourceRowId = treeRowId.session('server-a', 'inside-a');
        const source = buildSessionListDragSource({ tree: snapshotTree, sourceRowId });
        const result = resolveSessionListInstruction({
            tree: snapshotTree,
            source,
            pointer: { x: 160, y: 235 },
            foldersFeatureEnabled: true,
        });
        expectVisualToMatchInstruction(result);
        expect(result.instruction.kind).toBe('reorder-after');

        const intent = intentFromResult({ result, sourceRowId });

        // Commit phase: the live list reordered root-b before root-a in the
        // background. The commit must still land inside-a after root-a (the
        // visual target) and must preserve the background reorder.
        const setSessionFolderAssignment = vi.fn(async () => undefined);
        const setSessionListGroupOrderV1 = vi.fn();

        const committed = await commitSessionListDragIntent({
            intent,
            context: {
                latestItems: items(),
                sessionFoldersV1: folders(),
                sessionListGroupOrderV1: { 'project-a': ['server-a:root-b', 'server-a:root-a'] },
                sessionWorkspaceOrderV1: {},
                now: () => 100,
                setSessionFoldersV1: vi.fn(),
                setSessionListGroupOrderV1,
                setSessionWorkspaceOrderV1: vi.fn(),
                setSessionFolderAssignment,
            },
        });

        expect(committed).toEqual({ ok: true });
        expect(setSessionFolderAssignment).toHaveBeenCalledWith({
            serverId: 'server-a',
            sessionId: 'inside-a',
            folderId: null,
        });
        const order = setSessionListGroupOrderV1.mock.calls[0][0] as Record<string, string[]>;
        // commit target agrees with the visual target: inside-a immediately
        // after root-a, with the background root-b/root-a order preserved.
        expect(order['project-a'].indexOf('server-a:inside-a'))
            .toBe(order['project-a'].indexOf('server-a:root-a') + 1);
        expect(order['project-a'].indexOf('server-a:root-b'))
            .toBeLessThan(order['project-a'].indexOf('server-a:root-a'));
    });
});
