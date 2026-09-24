import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';
import type { ScmWorkingSnapshot, Session } from '@/sync/domains/state/storageTypes';
import { storage } from '@/sync/domains/state/storageStore';
import {
    clearMountedSessionRealtimeScmConsumerScopes,
    readMountedSessionRealtimeScmConsumerScopes,
} from '@/sync/runtime/sessionRealtimeScmConsumers';

const initialStorageState = storage.getInitialState();

type ExplicitScmConsumerHook = (sessionId: string | null, snapshot: ScmWorkingSnapshot | null) => void;

function buildSession(sessionId: string): Session {
    return {
        id: sessionId,
        seq: 1,
        createdAt: 1_000,
        updatedAt: 1_000,
        active: true,
        activeAt: 1_000,
        metadata: { path: '/repo/app', machineId: 'machine-a', host: 'test-host' },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        optimisticThinkingAt: null,
        encryptionMode: 'plain',
    };
}

function buildSnapshot(): ScmWorkingSnapshot {
    return {
        projectKey: 'machine-a:/repo',
        fetchedAt: 1_500,
        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
        capabilities: {
            readStatus: true,
            readDiffFile: true,
            readDiffCommit: true,
            readLog: true,
            writeInclude: true,
            writeExclude: true,
            writeCommit: true,
            writeBackout: true,
            writeRemoteFetch: true,
            writeRemotePull: true,
            writeRemotePush: true,
            worktreeCreate: true,
        },
        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
        stashCount: 0,
        hasConflicts: false,
        entries: [],
        totals: {
            includedFiles: 0,
            pendingFiles: 0,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 0,
            pendingRemoved: 0,
        },
    };
}

function seedSessionScmSnapshot(sessionId: string): void {
    storage.getState().applySessions([buildSession(sessionId)]);
    storage.getState().updateSessionProjectScmSnapshot(sessionId, buildSnapshot());
}

describe('session realtime SCM consumer hooks', () => {
    afterEach(() => {
        clearMountedSessionRealtimeScmConsumerScopes();
        storage.setState(initialStorageState, true);
        standardCleanup();
    });

    it('does not register a realtime SCM transcript consumer for generic snapshot reads', async () => {
        const sessionId = 'session-generic-scm-snapshot';
        seedSessionScmSnapshot(sessionId);
        const { useSessionProjectScmSnapshot } = await import('./hooks');
        const hook = await renderHook(() => useSessionProjectScmSnapshot(sessionId));

        try {
            expect(hook.getCurrent()).not.toBeNull();
            expect(readMountedSessionRealtimeScmConsumerScopes()).toHaveLength(0);
        } finally {
            await hook.unmount();
        }
    });

    it('registers a same-session SCM transcript consumer immediately and upgrades it when the snapshot loads', async () => {
        const sessionId = 'session-explicit-scm-consumer';
        storage.getState().applySessions([buildSession(sessionId)]);
        const hooks = await import('./hooks') as typeof import('./hooks') & {
            useSessionRealtimeScmTranscriptConsumer?: ExplicitScmConsumerHook;
        };
        expect(typeof hooks.useSessionRealtimeScmTranscriptConsumer).toBe('function');
        const useSessionRealtimeScmTranscriptConsumer = hooks.useSessionRealtimeScmTranscriptConsumer;
        if (typeof useSessionRealtimeScmTranscriptConsumer !== 'function') return;

        const hook = await renderHook(() => {
            const snapshot = hooks.useSessionProjectScmSnapshot(sessionId);
            useSessionRealtimeScmTranscriptConsumer(sessionId, snapshot);
            return snapshot;
        });

        try {
            expect(hook.getCurrent()).toBeNull();
            expect(readMountedSessionRealtimeScmConsumerScopes()).toEqual([
                {
                    sessionId,
                    needsMutationTranscript: true,
                },
            ]);

            await act(async () => {
                storage.getState().updateSessionProjectScmSnapshot(sessionId, buildSnapshot());
            });
            await hook.rerender();

            expect(hook.getCurrent()).not.toBeNull();
            expect(readMountedSessionRealtimeScmConsumerScopes()).toEqual([
                {
                    sessionId,
                    canonicalProjectKey: 'machine-a:/repo',
                    machineScopeId: 'machine-a',
                    repoRoot: '/repo',
                    needsMutationTranscript: true,
                },
            ]);
        } finally {
            await hook.unmount();
        }
        expect(readMountedSessionRealtimeScmConsumerScopes()).toHaveLength(0);
    });

    it('re-registers the mounted same-session fallback scope after a registry reset without requiring a parent rerender', async () => {
        const sessionId = 'session-reset-fallback-scm-consumer';
        storage.getState().applySessions([buildSession(sessionId)]);
        const hooks = await import('./hooks') as typeof import('./hooks') & {
            useSessionRealtimeScmTranscriptConsumer?: ExplicitScmConsumerHook;
        };
        expect(typeof hooks.useSessionRealtimeScmTranscriptConsumer).toBe('function');
        const useSessionRealtimeScmTranscriptConsumer = hooks.useSessionRealtimeScmTranscriptConsumer;
        if (typeof useSessionRealtimeScmTranscriptConsumer !== 'function') return;

        const hook = await renderHook(() => {
            const snapshot = hooks.useSessionProjectScmSnapshot(sessionId);
            useSessionRealtimeScmTranscriptConsumer(sessionId, snapshot);
            return snapshot;
        });

        try {
            expect(hook.getCurrent()).toBeNull();
            expect(readMountedSessionRealtimeScmConsumerScopes()).toEqual([
                {
                    sessionId,
                    needsMutationTranscript: true,
                },
            ]);

            await act(async () => {
                clearMountedSessionRealtimeScmConsumerScopes();
            });

            expect(hook.getCurrent()).toBeNull();
            expect(readMountedSessionRealtimeScmConsumerScopes()).toEqual([
                {
                    sessionId,
                    needsMutationTranscript: true,
                },
            ]);
        } finally {
            await hook.unmount();
        }
    });
});
