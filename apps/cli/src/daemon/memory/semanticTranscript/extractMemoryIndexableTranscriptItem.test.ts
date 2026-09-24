import { describe, expect, it } from 'vitest';

import { extractMemoryIndexableTranscriptItem } from './extractMemoryIndexableTranscriptItem';

const ctx = { encryptionKey: new Uint8Array([1]), encryptionVariant: 'legacy' as const };

describe('extractMemoryIndexableTranscriptItem', () => {
    it('converts user and assistant semantic messages into indexable memory items', () => {
        const user = extractMemoryIndexableTranscriptItem({
            sessionId: 'sess-1',
            row: {
                id: 'row-user',
                seq: 1,
                createdAt: 1000,
                messageRole: 'user',
                content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'remember the orchard plan' } } },
            },
            index: 0,
            ctx,
        });
        const assistant = extractMemoryIndexableTranscriptItem({
            sessionId: 'sess-1',
            row: {
                id: 'row-assistant',
                seq: 2,
                createdAt: 1001,
                messageRole: 'agent',
                content: { t: 'plain', v: { role: 'agent', content: { type: 'codex', provider: 'codex', data: { type: 'message', message: 'the orchard plan is saved' } } } },
            },
            index: 1,
            ctx,
        });

        expect(user).toEqual(expect.objectContaining({
            sessionId: 'sess-1',
            id: 'row-user',
            seq: 1,
            createdAtMs: 1000,
            role: 'user',
            kind: 'user_message',
            text: 'remember the orchard plan',
            textChars: 25,
            sourceStoredMessageRole: 'user',
        }));
        expect(assistant).toEqual(expect.objectContaining({
            sessionId: 'sess-1',
            id: 'row-assistant',
            seq: 2,
            role: 'assistant',
            kind: 'assistant_message',
            provider: 'codex',
            text: 'the orchard plan is saved',
            sourceStoredMessageRole: 'agent',
        }));
    });

    it('excludes tools, usage events, memory artifacts, and reasoning by default', () => {
        const rows = [
            { seq: 1, createdAt: 1, content: { t: 'plain', v: { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', name: 'Bash', input: { command: 'echo secret' } } } } } },
            { seq: 2, createdAt: 2, content: { t: 'plain', v: { role: 'agent', content: { type: 'codex', data: { type: 'token_count' } } } } },
            { seq: 3, createdAt: 3, content: { t: 'plain', v: { role: 'agent', content: { type: 'text', text: '[memory]' }, meta: { happier: { kind: 'session_summary_shard.v1', payload: {} } } } } },
            { seq: 4, createdAt: 4, content: { t: 'plain', v: { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', message: 'private chain' } } } } },
        ];

        const items = rows.map((row, index) => extractMemoryIndexableTranscriptItem({
            sessionId: 'sess-1',
            row,
            index,
            ctx,
        }));

        expect(items).toEqual([null, null, null, null]);
    });

    it('can include reasoning only when the content policy enables it', () => {
        const item = extractMemoryIndexableTranscriptItem({
            sessionId: 'sess-1',
            row: {
                seq: 4,
                createdAt: 4,
                messageRole: 'agent',
                content: { t: 'plain', v: { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', message: 'visible rationale' } } } },
            },
            index: 0,
            ctx,
            contentPolicy: { includeReasoning: true },
        });

        expect(item).toEqual(expect.objectContaining({
            role: 'assistant',
            kind: 'reasoning',
            text: 'visible rationale',
        }));
    });

    it('caps tool-call summaries and keeps raw tool results excluded even when summaries are enabled', () => {
        const toolCall = extractMemoryIndexableTranscriptItem({
            sessionId: 'sess-1',
            row: {
                seq: 5,
                createdAt: 5,
                messageRole: 'agent',
                content: {
                    t: 'plain',
                    v: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'tool-call',
                                name: 'Bash',
                                input: { command: `printf '${'x'.repeat(1000)}'` },
                            },
                        },
                    },
                },
            },
            index: 0,
            ctx,
            contentPolicy: { includeToolSummaries: true },
        });
        const toolResult = extractMemoryIndexableTranscriptItem({
            sessionId: 'sess-1',
            row: {
                seq: 6,
                createdAt: 6,
                messageRole: 'agent',
                content: {
                    t: 'plain',
                    v: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'tool-result',
                                output: `raw-tool-output-${'secret'.repeat(100)}`,
                            },
                        },
                    },
                },
            },
            index: 1,
            ctx,
            contentPolicy: { includeToolSummaries: true },
        });

        expect(toolCall).toEqual(expect.objectContaining({
            kind: 'tool_summary',
            role: 'assistant',
        }));
        expect(toolCall!.text.length).toBeLessThanOrEqual(500);
        expect(toolCall!.text).not.toContain('printf');
        expect(toolCall!.text).not.toContain('x'.repeat(20));
        expect(toolCall!.text).toContain('Bash');
        expect(toolResult).toBeNull();
    });
});
