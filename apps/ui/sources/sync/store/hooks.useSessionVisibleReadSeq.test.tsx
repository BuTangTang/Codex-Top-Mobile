import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';

import { useSessionVisibleReadSeq } from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storageStore';

afterEach(() => {
    standardCleanup();
});

function seedSessionMessages(sessionId: string, messagesById: Record<string, any>, ids: string[]): void {
    storage.setState((state) => ({
        ...state,
        sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: {
                messageIdsOldestFirst: ids,
                messagesById,
                messagesMap: messagesById,
                reducerState: {} as any,
                latestThinkingMessageId: null,
                latestThinkingMessageActivityAtMs: null,
                latestReadyEventSeq: null,
                latestReadyEventAt: null,
                messagesVersion: 1,
                lastAppliedAgentStateVersion: null,
                isLoaded: true,
            },
        },
    }));
}

describe('useSessionVisibleReadSeq', () => {
    it('returns null while the transcript is not loaded', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                sessionMessages: {
                    ...state.sessionMessages,
                    's-1': {
                        messageIdsOldestFirst: ['m-1'],
                        messagesById: { 'm-1': { id: 'm-1', kind: 'agent-text', localId: null, createdAt: 1, text: 'hi', seq: 4 } as any },
                        messagesMap: { 'm-1': { id: 'm-1', kind: 'agent-text', localId: null, createdAt: 1, text: 'hi', seq: 4 } as any },
                        reducerState: {} as any,
                        latestThinkingMessageId: null,
                        latestThinkingMessageActivityAtMs: null,
                        latestReadyEventSeq: null,
                        latestReadyEventAt: null,
                        messagesVersion: 1,
                        lastAppliedAgentStateVersion: null,
                        isLoaded: false,
                    },
                },
            }));

            const hook = await renderHook(() => useSessionVisibleReadSeq('s-1', {
                sessionSeq: 20,
                latestTurnStatus: 'completed',
            }), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toBeNull();

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('returns the highest committed visible message seq', async () => {
        const previousState = storage.getState();
        try {
            seedSessionMessages('s-1', {
                'm-1': { id: 'm-1', kind: 'agent-text', localId: null, createdAt: 1, text: 'hello', seq: 12 } as any,
            }, ['m-1']);

            const hook = await renderHook(() => useSessionVisibleReadSeq('s-1', {
                sessionSeq: 20,
                latestTurnStatus: 'in_progress',
            }), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toBe(12);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('ignores trailing maintenance events that do not affect unread state', async () => {
        const previousState = storage.getState();
        try {
            seedSessionMessages('s-1', {
                'm-visible': {
                    id: 'm-visible',
                    kind: 'agent-text',
                    localId: null,
                    createdAt: 1,
                    text: 'Visible assistant message',
                    seq: 945,
                } as any,
                'm-switch': {
                    id: 'm-switch',
                    kind: 'agent-event',
                    localId: null,
                    createdAt: 2,
                    seq: 946,
                    event: {
                        type: 'connected-service-account-switch',
                        serviceId: 'openai-codex',
                        groupId: 'codex-main',
                        fromProfileId: 'profile-a',
                        toProfileId: 'profile-b',
                        reason: 'usage_limit',
                        mode: 'hot_apply',
                    },
                } as any,
            }, ['m-visible', 'm-switch']);

            const hook = await renderHook(() => useSessionVisibleReadSeq('s-1', {
                sessionSeq: 946,
                latestTurnStatus: 'in_progress',
            }), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toBe(945);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('does not re-render the consumer when committed message content streams without changing seq', async () => {
        const previousState = storage.getState();
        try {
            seedSessionMessages('s-1', {
                'm-1': { id: 'm-1', kind: 'agent-text', localId: null, createdAt: 1, text: 'hello', seq: 12, isThinking: true } as any,
            }, ['m-1']);

            let renderCount = 0;
            const hook = await renderHook(() => {
                renderCount += 1;
                return useSessionVisibleReadSeq('s-1', {
                    sessionSeq: 20,
                    latestTurnStatus: 'in_progress',
                });
            }, {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const initialRenderCount = renderCount;
            expect(hook.getCurrent()).toBe(12);

            await act(async () => {
                storage.setState((state) => {
                    const session = state.sessionMessages['s-1'];
                    if (!session) return state;
                    const nextMessagesById = {
                        ...session.messagesById,
                        'm-1': {
                            ...session.messagesById['m-1'],
                            text: 'hello streaming update with more tokens',
                        },
                    };
                    return {
                        ...state,
                        sessionMessages: {
                            ...state.sessionMessages,
                            's-1': {
                                ...session,
                                messagesById: nextMessagesById,
                                messagesMap: nextMessagesById,
                                messagesVersion: session.messagesVersion + 1,
                            },
                        },
                    };
                });
            });

            expect(hook.getCurrent()).toBe(12);
            expect(renderCount).toBe(initialRenderCount);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('does not reread committed message seqs on unrelated store publishes', async () => {
        const previousState = storage.getState();
        try {
            let seqReadCount = 0;
            const message = {
                id: 'm-1',
                kind: 'agent-text',
                localId: null,
                createdAt: 1,
                text: 'hello',
                get seq() {
                    seqReadCount += 1;
                    return 12;
                },
            } as any;
            seedSessionMessages('s-1', { 'm-1': message }, ['m-1']);

            const hook = await renderHook(() => useSessionVisibleReadSeq('s-1', {
                sessionSeq: 20,
                latestTurnStatus: 'in_progress',
            }), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            expect(hook.getCurrent()).toBe(12);
            expect(seqReadCount).toBeGreaterThan(0);

            seqReadCount = 0;
            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    realtimeStatus: state.realtimeStatus === 'connected' ? 'disconnected' : 'connected',
                }));
            });

            expect(hook.getCurrent()).toBe(12);
            expect(seqReadCount).toBe(0);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('re-renders the consumer when a newer committed message seq is appended', async () => {
        const previousState = storage.getState();
        try {
            seedSessionMessages('s-1', {
                'm-1': { id: 'm-1', kind: 'agent-text', localId: null, createdAt: 1, text: 'hello', seq: 12 } as any,
            }, ['m-1']);

            const hook = await renderHook(() => useSessionVisibleReadSeq('s-1', {
                sessionSeq: 20,
                latestTurnStatus: 'in_progress',
            }), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            expect(hook.getCurrent()).toBe(12);

            await act(async () => {
                storage.setState((state) => {
                    const session = state.sessionMessages['s-1'];
                    if (!session) return state;
                    const nextMessagesById = {
                        ...session.messagesById,
                        'm-2': { id: 'm-2', kind: 'agent-text', localId: null, createdAt: 2, text: 'next', seq: 14 } as any,
                    };
                    return {
                        ...state,
                        sessionMessages: {
                            ...state.sessionMessages,
                            's-1': {
                                ...session,
                                messageIdsOldestFirst: ['m-1', 'm-2'],
                                messagesById: nextMessagesById,
                                messagesMap: nextMessagesById,
                                messagesVersion: session.messagesVersion + 1,
                            },
                        },
                    };
                });
            });

            expect(hook.getCurrent()).toBe(14);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('uses raw session seq for terminal sessions', async () => {
        const previousState = storage.getState();
        try {
            seedSessionMessages('s-1', {
                'm-1': { id: 'm-1', kind: 'agent-text', localId: null, createdAt: 1, text: 'hello', seq: 12 } as any,
            }, ['m-1']);

            const hook = await renderHook(() => useSessionVisibleReadSeq('s-1', {
                sessionSeq: 20,
                latestTurnStatus: 'completed',
            }), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toBe(20);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
