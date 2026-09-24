import type { Metadata } from '@/api/types';
import { createSessionModeOverrideSynchronizer } from '@/agent/runtime/sessionModeOverrideSync';
import { describe, expect, it, vi } from 'vitest';

import { reconcileCodexAppServerOverridesBeforeTurn } from './reconcileCodexAppServerOverridesBeforeTurn';

describe('reconcileCodexAppServerOverridesBeforeTurn', () => {
    it('refreshes metadata and applies a default mode override before the next turn', async () => {
        let metadata = createCodexAppServerModeMetadata('plan', 1);
        const setSessionMode = vi.fn(async (_modeId: string) => {});
        const sessionModeSync = createSessionModeOverrideSynchronizer({
            session: {
                getMetadataSnapshot: () => metadata,
            },
            runtime: {
                setSessionMode,
            },
            isStarted: () => true,
        });

        sessionModeSync.syncFromMetadata();
        await sessionModeSync.flushPendingAfterStart();

        expect(setSessionMode).toHaveBeenCalledExactlyOnceWith('plan');

        const refreshSessionSnapshotFromServerBestEffort = vi.fn(async () => {
            metadata = createCodexAppServerModeMetadata('default', 2);
        });

        await reconcileCodexAppServerOverridesBeforeTurn({
            session: { refreshSessionSnapshotFromServerBestEffort },
            syncOverridesFromMetadata: () => sessionModeSync.syncFromMetadata(),
            sessionModeSync,
        });

        expect(refreshSessionSnapshotFromServerBestEffort).toHaveBeenCalledExactlyOnceWith({
            reason: 'waitForMetadataUpdate',
        });
        expect(setSessionMode).toHaveBeenCalledTimes(2);
        expect(setSessionMode).toHaveBeenLastCalledWith('default');
    });
});

function createCodexAppServerModeMetadata(modeId: string, updatedAt: number): Metadata {
    return {
        path: '/tmp/workspace',
        host: 'test-host',
        homeDir: '/home/tester',
        happyHomeDir: '/home/tester/.happier',
        happyLibDir: '/home/tester/.happier/lib',
        happyToolsDir: '/home/tester/.happier/tools',
        sessionModeOverrideV1: {
            v: 1,
            modeId,
            updatedAt,
        },
        sessionModesV1: {
            v: 1,
            provider: 'codex',
            currentModeId: 'plan',
            updatedAt: 1,
            availableModes: [
                { id: 'default', name: 'Default' },
                { id: 'plan', name: 'Plan' },
            ],
        },
    } satisfies Metadata;
}
