import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    serverFetch: vi.fn(),
}));

vi.mock('@/sync/http/client', () => ({
    serverFetch: mocks.serverFetch,
}));

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('moveSessionFolderAssignments', () => {
    beforeEach(async () => {
        mocks.serverFetch.mockReset();
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        getStorage().getState().clearSessionFolderAssignmentsForServer('server-a');
    });

    it('applies the move target instead of restoring previous assignment snapshots', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { moveSessionFolderAssignments } = await import('./moveSessionFolderAssignments');
        getStorage().getState().applySessionFolderAssignments('server-a', [
            { sessionId: 's1', folderId: 'deleted-folder' },
            { sessionId: 's2', folderId: 'deleted-folder' },
        ]);
        mocks.serverFetch.mockResolvedValueOnce(jsonResponse({
            assignments: [
                { sessionId: 's1', folderId: 'deleted-folder' },
                { sessionId: 's2', folderId: 'deleted-folder' },
            ],
            affectedCount: 2,
            toFolderId: 'parent-folder',
        }));

        await moveSessionFolderAssignments({
            credentials: { token: 'token-a', secret: 'secret-a' },
            serverId: 'server-a',
            fromFolderIds: ['deleted-folder'],
            toFolderId: 'parent-folder',
        });

        expect(getStorage().getState().sessionFolderAssignmentsBySessionKey).toMatchObject({
            'server-a:s1': 'parent-folder',
            'server-a:s2': 'parent-folder',
        });
    });
});
