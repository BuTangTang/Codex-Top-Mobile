import { describe, expect, it } from 'vitest';

import type { ToolCallMessage } from './messageTypes';
import {
    buildSessionMessageRouteId,
    createSessionMessageRouteIdResolver,
    parseStableSessionMessageRouteId,
    resolveMessageRouteIdForDisplay,
    resolveSessionMessageRouteId,
} from './messageRouteIds';
import { createReducer, reducer } from '@/sync/reducer/reducer';
import type { NormalizedMessage } from '@/sync/typesRaw';

function makeToolMessage(id: string): ToolCallMessage {
    return {
        kind: 'tool-call',
        id,
        realID: null,
        localId: null,
        createdAt: 1,
        tool: {
            id: 'call_read_1',
            name: 'read',
            state: 'completed',
            input: {},
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            description: null,
            result: {},
        },
        children: [],
    };
}

describe('messageRouteIds', () => {
    it('parses stable route ids through the canonical route-id owner', () => {
        expect(parseStableSessionMessageRouteId('server:server-msg-1')).toEqual({
            kind: 'server',
            value: 'server-msg-1',
        });
        expect(parseStableSessionMessageRouteId('local:local-msg-1')).toEqual({
            kind: 'local',
            value: 'local-msg-1',
        });
        expect(parseStableSessionMessageRouteId('tool:call_read_1')).toEqual({
            kind: 'tool',
            value: 'call_read_1',
        });
        expect(parseStableSessionMessageRouteId('server:   ')).toBeNull();
        expect(parseStableSessionMessageRouteId('plain-message-id')).toBeNull();
    });

    it('preserves whitespace-distinct opaque local ids in stable routes', () => {
        expect(parseStableSessionMessageRouteId('local: request-1')).toEqual({
            kind: 'local',
            value: ' request-1',
        });
        expect(parseStableSessionMessageRouteId('local:request-1 ')).toEqual({
            kind: 'local',
            value: 'request-1 ',
        });
    });

    it('builds a durable server route for an internal message id when reducer state knows the original id', () => {
        const reducerState = createReducer();
        reducerState.messageIds.set('server-msg-1', 'internal-1');

        const message = makeToolMessage('internal-1');

        const routeId = buildSessionMessageRouteId({
            messageId: message.id,
            messagesById: { [message.id]: message },
            reducerState,
        });

        expect(routeId).toBe('server:server-msg-1');
    });

    it('keeps canonical route priority for every message in a batch', () => {
        const reducerState = createReducer();
        reducerState.messageIds.set(' first-original ', 'aliased');
        reducerState.messageIds.set('later-original', 'aliased');
        reducerState.messageIds.set('   ', 'blank-first');
        reducerState.messageIds.set('ignored-alias', 'blank-first');
        reducerState.messageIds.set('original-without-message', 'missing');
        const messagesById = {
            aliased: { ...makeToolMessage('aliased'), realID: 'current-real' },
            'blank-first': { ...makeToolMessage('blank-first'), realID: 'fallback-real' },
            real: { ...makeToolMessage('real'), realID: ' real-server ' },
            tool: makeToolMessage('tool'),
            local: {
                ...makeToolMessage('local'), localId: ' local-opaque ',
                tool: { ...makeToolMessage('local').tool, id: undefined },
            },
            internal: {
                ...makeToolMessage('internal'), tool: { ...makeToolMessage('internal').tool, id: undefined },
            },
        };
        const resolve = createSessionMessageRouteIdResolver(reducerState);
        for (const [messageId, expected] of [
            ['aliased', 'server:first-original'],
            ['blank-first', 'server:fallback-real'],
            ['missing', 'server:original-without-message'],
            ['real', 'server:real-server'],
            ['tool', 'tool:call_read_1'],
            ['local', 'local: local-opaque '],
            ['internal', 'internal'],
            [' real ', 'server:real-server'],
            ['unknown', 'unknown'],
            ['   ', null],
        ] as const) {
            expect(buildSessionMessageRouteId({ messageId, messagesById, reducerState })).toBe(expected);
            expect(resolve({ messageId, messagesById })).toBe(expected);
        }
    });

    it('reads mutated mappings in a fresh batch instead of retaining an earlier index', () => {
        const reducerState = createReducer();
        reducerState.messageIds.set('original-before', 'internal');
        const input = { messageId: 'internal', messagesById: { internal: makeToolMessage('internal') } };
        expect(createSessionMessageRouteIdResolver(reducerState)(input)).toBe('server:original-before');
        reducerState.messageIds.delete('original-before');
        reducerState.messageIds.set('original-after', 'internal');
        expect(createSessionMessageRouteIdResolver(reducerState)(input)).toBe('server:original-after');
        expect(createSessionMessageRouteIdResolver(null)(input)).toBe('tool:call_read_1');
    });

    it('prefers reducer-backed durable routes over the stale public message id used for display', () => {
        const reducerState = createReducer();
        reducerState.messageIds.set('server-msg-1', 'internal-1');

        const message = makeToolMessage('internal-1');

        const routeId = resolveMessageRouteIdForDisplay({
            message,
            messagesById: { [message.id]: message },
            reducerState,
        });

        expect(routeId).toBe('server:server-msg-1');
    });

    it('falls back to a stable local route when a tool-call has no server id or tool id', () => {
        const message = {
            ...makeToolMessage('internal-1'),
            localId: 'local-msg-1',
            tool: {
                ...makeToolMessage('internal-1').tool,
                id: undefined,
            },
        } satisfies ToolCallMessage;

        const routeId = resolveMessageRouteIdForDisplay({
            message,
            messagesById: { [message.id]: message },
            reducerState: createReducer(),
        });

        expect(routeId).toBe('local:local-msg-1');
    });

    it('resolves a local route back to the current internal message id after reload', () => {
        const reducerState = createReducer();
        reducerState.localIds.set('local-msg-1', 'internal-1');

        const resolved = resolveSessionMessageRouteId({
            routeMessageId: 'local:local-msg-1',
            messagesById: {},
            reducerState,
        });

        expect(resolved).toBe('internal-1');
    });

    it('resolves a stable server route for a persisted tool-call message after reducer hydration', () => {
        const reducerState = createReducer();
        const normalizedToolCall = {
            id: 'server-tool-msg-1',
            localId: null,
            createdAt: 1,
            role: 'agent',
            isSidechain: false,
            content: [
                {
                    type: 'tool-call',
                    id: 'call_read_1',
                    name: 'Read',
                    input: {},
                    description: 'Read file',
                    uuid: 'uuid-call-1',
                    parentUUID: null,
                },
            ],
        } satisfies NormalizedMessage;

        const reduced = reducer(reducerState, [normalizedToolCall]);
        const internalMessageId = reduced.messages[0]?.id ?? null;
        expect(internalMessageId).toBeTruthy();

        const resolved = resolveSessionMessageRouteId({
            routeMessageId: 'server:server-tool-msg-1',
            messagesById: Object.fromEntries(reduced.messages.map((message) => [message.id, message])),
            reducerState,
        });

        expect(resolved).toBe(internalMessageId);
    });
});
