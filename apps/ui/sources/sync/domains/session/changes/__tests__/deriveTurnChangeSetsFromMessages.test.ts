import { describe, expect, it, vi } from 'vitest';

import type { Message } from '@/sync/domains/messages/messageTypes';

import { deriveTurnChangeSetsFromMessages } from '../derivation/deriveTurnChangeSetsFromMessages';

function makeDiffMessage(): Message {
    return {
        kind: 'tool-call',
        id: 'tool_1',
        localId: null,
        createdAt: 10,
        tool: {
            name: 'Diff',
            state: 'completed',
            input: {
                files: [
                    {
                        file_path: 'src/app.ts',
                        oldText: 'a\n',
                        newText: 'b\n',
                    },
                ],
                _happier: {
                    v: 2,
                    protocol: 'codex',
                    provider: 'codex',
                    rawToolName: 'CodexDiff',
                    canonicalToolName: 'Diff',
                    sessionChangeScope: 'turn',
                    turnId: 'turn_1',
                    sessionId: 'session_1',
                    source: 'provider_native',
                    confidence: 'exact',
                    turnStatus: 'completed',
                    seqRange: {
                        startSeqInclusive: 1,
                        endSeqInclusive: 4,
                    },
                },
            },
            createdAt: 10,
            startedAt: 10,
            completedAt: 11,
            description: null,
            result: { status: 'completed' },
        },
        children: [],
    };
}

function makePatchMessage(): Message {
    return {
        kind: 'tool-call',
        id: 'tool_patch_1',
        localId: null,
        createdAt: 9,
        tool: {
            name: 'Patch',
            state: 'completed',
            input: {
                changes: [
                    {
                        path: 'src/app.ts',
                        kind: { type: 'update', move_path: null },
                        diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-a\n+b\n',
                    },
                ],
                _happier: {
                    v: 2,
                    protocol: 'codex',
                    provider: 'codex',
                    rawToolName: 'CodexPatch',
                    canonicalToolName: 'Patch',
                    sessionChangeScope: 'turn',
                    turnId: 'turn_1',
                    sessionId: 'session_1',
                    source: 'provider_tool',
                    confidence: 'strong',
                    turnStatus: 'completed',
                    seqRange: {
                        startSeqInclusive: 1,
                        endSeqInclusive: 3,
                    },
                },
            },
            createdAt: 9,
            startedAt: 9,
            completedAt: 10,
            description: null,
            result: { status: 'completed' },
        },
        children: [],
    };
}

describe('deriveTurnChangeSetsFromMessages', () => {
    it('reads canonical turn-scoped Diff tool messages into turn change sets', async () => {
        vi.resetModules();
        const { deriveTurnChangeSetsFromMessages } = await import('../derivation/deriveTurnChangeSetsFromMessages');
        const result = deriveTurnChangeSetsFromMessages([makeDiffMessage()]);

        expect(result).toEqual([
            expect.objectContaining({
                turnId: 'turn_1',
                sessionId: 'session_1',
                files: [
                    expect.objectContaining({
                        filePath: 'src/app.ts',
                        oldText: 'a\n',
                        newText: 'b\n',
                    }),
                ],
            }),
        ]);
    });

    it('reads turn-scoped Patch tool messages into turn change sets', async () => {
        vi.resetModules();
        const { deriveTurnChangeSetsFromMessages } = await import('../derivation/deriveTurnChangeSetsFromMessages');
        const result = deriveTurnChangeSetsFromMessages([makePatchMessage()]);

        expect(result).toEqual([
            expect.objectContaining({
                turnId: 'turn_1',
                sessionId: 'session_1',
                files: [
                    expect.objectContaining({
                        filePath: 'src/app.ts',
                        unifiedDiff: expect.stringContaining('+++ b/src/app.ts'),
                        source: 'provider_tool',
                        confidence: 'strong',
                    }),
                ],
            }),
        ]);
    });

    it('prefers a canonical Diff over a Patch for the same turn', async () => {
        vi.resetModules();
        const { deriveTurnChangeSetsFromMessages } = await import('../derivation/deriveTurnChangeSetsFromMessages');
        const result = deriveTurnChangeSetsFromMessages([makePatchMessage(), makeDiffMessage()]);

        expect(result).toHaveLength(1);
        expect(result[0]?.files[0]).toEqual(expect.objectContaining({
            filePath: 'src/app.ts',
            oldText: 'a\n',
            newText: 'b\n',
            source: 'provider_native',
        }));
    });
});
