import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';

import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';
import type { Automation } from '@/sync/domains/automations/automationTypes';
import {
    useOpenApprovalArtifactsForSession,
    useSessionAutomationsEnabledCount,
} from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storageStore';

afterEach(() => {
    standardCleanup();
});

function approvalArtifact(input: Readonly<{
    id: string;
    sessionId: string;
    updatedAt: number;
}>): DecryptedArtifact {
    return {
        id: input.id,
        header: {
            v: 1,
            kind: 'approval_request.v1',
            title: input.id,
            approvalStatus: 'open',
            sessionId: input.sessionId,
            actionId: 'session.list',
            approvalSummary: `Approval ${input.id}`,
        },
        title: input.id,
        sessions: [input.sessionId],
        draft: false,
        headerVersion: 1,
        seq: input.updatedAt,
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
        isDecrypted: true,
    };
}

function automation(input: Readonly<{
    id: string;
    sessionId: string;
    enabled?: boolean;
}>): Automation {
    return {
        id: input.id,
        name: input.id,
        description: null,
        enabled: input.enabled ?? true,
        schedule: {
            kind: 'cron',
            scheduleExpr: '* * * * *',
            everyMs: null,
            timezone: null,
        },
        targetType: 'existing_session',
        templateCiphertext: JSON.stringify({
            kind: 'happier_automation_template_plain_v1',
            payload: {},
            existingSessionId: input.sessionId,
        }),
        templateVersion: 1,
        nextRunAt: null,
        lastRunAt: null,
        createdAt: 1,
        updatedAt: 1,
        assignments: [],
    };
}

describe('session-scoped detail projections', () => {
    it('returns open approval artifacts for one session without globally sorting unrelated artifacts on publish', async () => {
        const previousState = storage.getState();
        try {
            let unrelatedHeaderReadCount = 0;
            const unrelated = approvalArtifact({ id: 'other', sessionId: 'other-session', updatedAt: 3 });
            Object.defineProperty(unrelated, 'header', {
                configurable: true,
                get() {
                    unrelatedHeaderReadCount += 1;
                    return {
                        v: 1,
                        kind: 'approval_request.v1',
                        title: 'other',
                        approvalStatus: 'open',
                        sessionId: 'other-session',
                        actionId: 'session.list',
                        approvalSummary: 'Approval other',
                    };
                },
            });

            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                artifacts: {
                    newer: approvalArtifact({ id: 'newer', sessionId: 's-1', updatedAt: 2 }),
                    older: approvalArtifact({ id: 'older', sessionId: 's-1', updatedAt: 1 }),
                    other: unrelated,
                },
            }));

            const hook = await renderHook(
                () => useOpenApprovalArtifactsForSession('s-1'),
                { flushOptions: { cycles: 1, turns: 4 } },
            );
            expect(hook.getCurrent().map((entry) => entry.artifact.id)).toEqual(['newer', 'older']);
            expect(unrelatedHeaderReadCount).toBeGreaterThan(0);

            const first = hook.getCurrent();
            unrelatedHeaderReadCount = 0;
            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    realtimeStatus: state.realtimeStatus === 'connected' ? 'disconnected' : 'connected',
                }));
            });

            expect(hook.getCurrent()).toBe(first);
            expect(unrelatedHeaderReadCount).toBe(0);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('reuses the session approval artifacts result when only unrelated artifacts change', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                artifacts: {
                    newer: approvalArtifact({ id: 'newer', sessionId: 's-1', updatedAt: 2 }),
                    older: approvalArtifact({ id: 'older', sessionId: 's-1', updatedAt: 1 }),
                    other: approvalArtifact({ id: 'other', sessionId: 'other-session', updatedAt: 3 }),
                },
            }));

            const hook = await renderHook(
                () => useOpenApprovalArtifactsForSession('s-1'),
                { flushOptions: { cycles: 1, turns: 4 } },
            );
            expect(hook.getCurrent().map((entry) => entry.artifact.id)).toEqual(['newer', 'older']);

            const first = hook.getCurrent();
            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    artifacts: {
                        ...state.artifacts,
                        other: approvalArtifact({ id: 'other-updated', sessionId: 'other-session', updatedAt: 4 }),
                    },
                }));
            });

            expect(hook.getCurrent()).toBe(first);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('counts enabled automations for one session without rereading unrelated automations on publish', async () => {
        const previousState = storage.getState();
        try {
            let unrelatedTemplateReadCount = 0;
            const unrelated = automation({ id: 'other', sessionId: 'other-session' });
            Object.defineProperty(unrelated, 'templateCiphertext', {
                configurable: true,
                get() {
                    unrelatedTemplateReadCount += 1;
                    return JSON.stringify({
                        kind: 'happier_automation_template_plain_v1',
                        payload: {},
                        existingSessionId: 'other-session',
                    });
                },
            });

            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                automations: {
                    linked: automation({ id: 'linked', sessionId: 's-1' }),
                    disabled: automation({ id: 'disabled', sessionId: 's-1', enabled: false }),
                    other: unrelated,
                },
            }));

            const hook = await renderHook(
                () => useSessionAutomationsEnabledCount('s-1'),
                { flushOptions: { cycles: 1, turns: 4 } },
            );
            expect(hook.getCurrent()).toBe(1);
            expect(unrelatedTemplateReadCount).toBeGreaterThan(0);

            unrelatedTemplateReadCount = 0;
            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    realtimeStatus: state.realtimeStatus === 'connected' ? 'disconnected' : 'connected',
                }));
            });

            expect(hook.getCurrent()).toBe(1);
            expect(unrelatedTemplateReadCount).toBe(0);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
