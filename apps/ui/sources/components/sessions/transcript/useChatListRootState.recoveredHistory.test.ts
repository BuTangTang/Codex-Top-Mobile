import { describe, expect, it } from 'vitest';
import { renderHook } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createSessionMessagesFixture, createToolCallMessageFixture } from '@/dev/testkit/fixtures/transcriptFixtures';

import type { Message } from '@/sync/domains/messages/messageTypes';

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
