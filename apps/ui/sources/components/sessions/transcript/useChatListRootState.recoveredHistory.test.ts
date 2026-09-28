import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderHook } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createSessionMessagesFixture, createToolCallMessageFixture, createPendingMessageFixture } from '@/dev/testkit/fixtures/transcriptFixtures';

import type { Message } from '@/sync/domains/messages/messageTypes';
import type { ChatListProps } from './chatListTypes';

import { resolveLatestCommittedActivityKey, useChatListRootState } from './useChatListRootState';

function agentText(id: string, overrides: Partial<Message> = {}): Message {
    return {
        id,
        kind: 'agent-text',
        localId: null,
        createdAt: 1_000,
        seq: 1,
        text: id,
        ...overrides,
    } as Message;
}

describe('resolveLatestCommittedActivityKey', () => {
    // 从真实消息 store 到列表源投影，普通工具不能进入分组和虚拟行；审批与原数据仍保留。
    it('omits ordinary phone desktop tools before grouping and restores them when the surface changes', async () => {
        const session = createSessionFixture({ id: 'phone-desktop-tool-projection', active: true });
        const ordinary = createToolCallMessageFixture({ id: 'ordinary-tool-process' });
        const pending = createToolCallMessageFixture({ id: 'pending-approval', tool: {
            ...ordinary.tool, permission: { id: 'permission-1', status: 'pending' },
        } });
        const question = createToolCallMessageFixture({ id: 'question-tool', tool: {
            ...ordinary.tool, name: 'AskUserQuestion',
            permission: { id: 'input-request-1', kind: 'user_action', status: 'pending' },
            input: { questions: [{ question: 'Synthetic question?', options: [{ label: 'A' }] }] },
        } });
        const user: Message = { kind: 'user-text', id: 'user', localId: null, createdAt: 0, text: 'synthetic user' };
        const assistant = agentText('assistant');
        const messages = [user, ordinary, pending, question, assistant];
        const original = createSessionMessagesFixture({ isLoaded: true,
            messageIdsOldestFirst: messages.map((message) => message.id),
            messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
        });
        storage.setState({ sessionMessages: { [session.id]: original } });
        const hook = await renderHook((hideOrdinaryToolCalls: boolean) => useChatListRootState({ session, hideOrdinaryToolCalls }), {
            initialProps: true,
        });
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['user', 'pending-approval', 'assistant']);
        expect(JSON.stringify(hook.getCurrent().internalProps.items)).not.toContain('ordinary-tool-process');
        expect(JSON.stringify(hook.getCurrent().internalProps.items)).toContain('pending-approval');
        expect(JSON.stringify(hook.getCurrent().internalProps.items)).toContain('input-request-1');
        expect(JSON.stringify(hook.getCurrent().internalProps.items)).not.toContain('question-tool');
        expect(storage.getState().sessionMessages[session.id]).toBe(original);
        await hook.rerender(false);
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(original.messageIdsOldestFirst);
        expect(JSON.stringify(hook.getCurrent().internalProps.items)).toContain('ordinary-tool-process');
    });

    it('keeps recovered history from becoming tail-follow activity while live messages still advance once', () => {
        const live = agentText('live', { seq: 1 });
        const history = agentText('history', {
            seq: 2,
            sourceCreatedAt: 100,
            transcriptObservationProvenance: { kind: 'non_dependent', source: 'history' },
        });
        const nextLive = agentText('next-live', {
            seq: 3,
        });
        const messagesById = { live, history, 'next-live': nextLive };

        expect(resolveLatestCommittedActivityKey({
            messageIdsOldestFirst: ['live'],
            messagesById,
        })).toBe('live');
        expect(resolveLatestCommittedActivityKey({
            messageIdsOldestFirst: ['live', 'history'],
            messagesById,
        })).toBe('live');
        expect(resolveLatestCommittedActivityKey({
            messageIdsOldestFirst: ['live', 'history', 'next-live'],
            messagesById,
        })).toBe('next-live');
    });
});

afterEach(() => vi.restoreAllMocks());

function seed(id: string) {
    const session = createSessionFixture({ id, active: true });
    const ordinary = createToolCallMessageFixture({ id: 'ordinary' });
    const pending = createToolCallMessageFixture({ id: 'approval', tool: { ...ordinary.tool, permission: { id: 'permission', status: 'pending' } } });
    const user = { kind: 'user-text' as const, id: 'user', localId: null, createdAt: 1, text: 'synthetic' };
    const messages = [user, ordinary, pending];
    const original = createSessionMessagesFixture({ isLoaded: true,
        messageIdsOldestFirst: messages.map(m => m.id),
        messagesById: Object.fromEntries(messages.map(m => [m.id, m])),
    });
    storage.setState({ sessionMessages: { [id]: original }, sessionPending: {} });
    return { session, original, pending, ordinary };
}

const props = (session: ReturnType<typeof createSessionFixture>, extra: Partial<ChatListProps> = {}) => ({ session, hideOrdinaryToolCalls: true, ...extra });

describe('useChatListRootState visible-message projection', () => {
    it('does not rescan source ids for pending-only and follow-only updates', async () => {
        const { session, original } = seed('synthetic-filter-pending');
        const filter = vi.spyOn(original.messageIdsOldestFirst, 'filter');
        const hook = await renderHook((p: ChatListProps) => useChatListRootState(p), { initialProps: props(session) });
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['user', 'approval']);
        const firstCalls = filter.mock.calls.length;
        expect(firstCalls).toBeGreaterThan(0);
        await act(async () => storage.getState().upsertPendingMessage(session.id, createPendingMessageFixture({ id: 'synthetic-outbound', localId: 'synthetic-outbound', source: 'local_outbound', directSessionExternalControl: true })));
        expect(JSON.stringify(hook.getCurrent().internalProps.items)).toContain('synthetic-outbound');
        expect.soft(filter.mock.calls.length).toBe(firstCalls);
        await hook.rerender(props(session, { followBottomIntentKey: 1 }));
        expect.soft(filter.mock.calls.length).toBe(firstCalls);
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['user', 'approval']);
        await hook.unmount();
    });

    it('rechecks in-place message updates when the original messagesVersion advances', async () => {
        const { session, original, pending } = seed('synthetic-filter-version');
        const hook = await renderHook((p: ChatListProps) => useChatListRootState(p), { initialProps: props(session) });
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['user', 'approval']);
        original.messagesById.approval = { ...pending, tool: { ...pending.tool, permission: { id: 'permission', status: 'approved' } } };
        await act(async () => storage.setState({ sessionMessages: { [session.id]: { ...original, messagesVersion: 1 } } }));
        expect(storage.getState().sessionMessages[session.id].messagesById).toBe(original.messagesById);
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['user']);
        await hook.unmount();
    });

    it('rechecks session permissions and hide-tools changes without altering source order', async () => {
        const { session, original } = seed('synthetic-filter-permission');
        const hook = await renderHook((p: ChatListProps) => useChatListRootState(p), { initialProps: props(session) });
        await hook.rerender(props({ ...session, canApprovePermissions: false, accessLevel: 'view' }));
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['user']);
        await hook.rerender(props(session, { hideOrdinaryToolCalls: false }));
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toBe(original.messageIdsOldestFirst);
        await hook.rerender(props(session));
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['user', 'approval']);
        await hook.unmount();
    });

    it('rechecks a switched session and appended source messages', async () => {
        const { session, original } = seed('synthetic-filter-first');
        const hook = await renderHook((p: ChatListProps) => useChatListRootState(p), { initialProps: props(session) });
        const next = createSessionFixture({ id: 'synthetic-filter-second', active: true });
        const nextMessages = createSessionMessagesFixture({ ...original, messageIdsOldestFirst: ['approval', 'user'] });
        await act(async () => storage.setState({ sessionMessages: { [session.id]: original, [next.id]: nextMessages } }));
        await hook.rerender(props(next));
        expect(hook.getCurrent().boundary.key).toBe(next.id);
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['approval', 'user']);
        const assistant = { kind: 'agent-text' as const, id: 'assistant', localId: null, createdAt: 2, text: 'synthetic' };
        await act(async () => storage.setState({ sessionMessages: { [next.id]: { ...nextMessages, messagesVersion: 1, messageIdsOldestFirst: [...nextMessages.messageIdsOldestFirst, assistant.id], messagesById: { ...nextMessages.messagesById, assistant } } } }));
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['approval', 'user', 'assistant']);
        await hook.unmount();
    });
    it('invalidates fork origin changes so an inherited approval remains read-only', async () => {
        const parent = createSessionFixture({ id: 'synthetic-filter-parent', active: true });
        const child = createSessionFixture({ id: 'synthetic-filter-child', active: true,
            metadata: { ...parent.metadata!, forkV1: { v: 1, parentSessionId: parent.id,
                parentCutoffSeqInclusive: 1, createdAtMs: 1, strategy: 'provider_native' } },
        });
        const pending = createToolCallMessageFixture({ id: 'shared-approval', seq: 1,
            tool: { name: 'edit', state: 'running', input: {}, createdAt: 1, startedAt: 1,
                completedAt: null, description: null, permission: { id: 'permission', status: 'pending' } },
        });
        const user = { kind: 'user-text' as const, id: 'child-user', localId: null, createdAt: 3, seq: 3, text: 'synthetic' };
        const rows = {
            [parent.id]: createSessionMessagesFixture({ isLoaded: true, messageIdsOldestFirst: [pending.id], messagesById: { [pending.id]: pending } }),
            [child.id]: createSessionMessagesFixture({ isLoaded: true, messageIdsOldestFirst: [pending.id, user.id], messagesById: { [pending.id]: { ...pending, seq: 2 }, [user.id]: user } }),
        };
        storage.setState({ sessions: { [parent.id]: parent, [child.id]: child }, sessionMessages: rows,
            sessionMessagesHistoryStartLoaded: {}, sessionPending: {} });
        const hook = await renderHook((p: ChatListProps) => useChatListRootState(p), { initialProps: props(child) });
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['shared-approval', 'child-user']);
        await act(async () => storage.setState({ sessionMessagesHistoryStartLoaded: { [child.id]: true } }));
        expect(hook.getCurrent().boundary.eligibleMessageIdsInOrder).toEqual(['child-user']);
        await hook.unmount();
    });

});
