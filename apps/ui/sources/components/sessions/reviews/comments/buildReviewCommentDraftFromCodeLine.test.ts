import { describe, expect, it } from 'vitest';

import { buildCodeLinesFromFile } from '@/components/ui/code/model/buildCodeLinesFromFile';
import { buildCodeLinesFromUnifiedDiff } from '@/components/ui/code/model/buildCodeLinesFromUnifiedDiff';
import { computeLineContentHash } from '@/utils/text/lineContentHash';

import {
    buildReviewCommentDraftFromCodeLine,
    buildReviewCommentDraftFromCodeLineRange,
    buildReviewCommentDraftFromMarkdownRange,
} from './buildReviewCommentDraftFromCodeLine';

describe('buildReviewCommentDraftFromCodeLine', () => {
    it('builds a normalized diff line anchor and snapshot for added lines', () => {
        const lines = buildCodeLinesFromUnifiedDiff({
            unifiedDiff: [
                'diff --git a/src/a.ts b/src/a.ts',
                '--- a/src/a.ts',
                '+++ b/src/a.ts',
                '@@ -1,1 +1,1 @@',
                '+const a = 2;',
            ].join('\n'),
        });
        const add = lines.find((l) => l.kind === 'add');
        if (!add) throw new Error('Expected an add line');

        const draft = buildReviewCommentDraftFromCodeLine({
            filePath: 'src/a.ts',
            source: 'diff',
            lines,
            targetLine: add,
            body: 'Please rename',
            contextRadius: 2,
            nowMs: 123,
            id: 'c1',
        });

        expect(draft).toMatchObject({
            id: 'c1',
            filePath: 'src/a.ts',
            source: 'diff',
            createdAt: 123,
            body: 'Please rename',
            anchor: {
                kind: 'line',
                filePath: 'src/a.ts',
                line: add.newLine,
                side: 'after',
                lineHash: computeLineContentHash('+const a = 2;'),
            },
        });
        expect(draft.snapshot.selectedLines).toEqual(['+const a = 2;']);
    });

    it('builds a normalized file line anchor and snapshot for file lines', () => {
        const lines = buildCodeLinesFromFile({ text: ['const a = 1;', 'const b = 2;  '].join('\n') });
        const second = lines[1]!;

        const draft = buildReviewCommentDraftFromCodeLine({
            filePath: 'src/b.ts',
            source: 'file',
            lines,
            targetLine: second,
            body: 'Consider extracting',
            contextRadius: 1,
            nowMs: 456,
            id: 'c2',
        });

        expect(draft.anchor).toEqual({
            kind: 'line',
            filePath: 'src/b.ts',
            line: 2,
            lineHash: computeLineContentHash('const b = 2;  '),
        });
        expect(draft.snapshot.selectedLines).toEqual(['const b = 2;']);
    });

    it('builds a normalized file range anchor and snapshot for contiguous file lines', () => {
        const lines = buildCodeLinesFromFile({ text: ['before();', 'first();', 'second();', 'after();'].join('\n') });

        const draft = buildReviewCommentDraftFromCodeLineRange({
            filePath: 'src/range.ts',
            source: 'file',
            lines,
            targetLines: [lines[1]!, lines[2]!],
            body: 'Review both lines together',
            contextRadius: 1,
            nowMs: 789,
            id: 'c3',
        });

        expect(draft).toMatchObject({
            id: 'c3',
            filePath: 'src/range.ts',
            source: 'file',
            createdAt: 789,
            body: 'Review both lines together',
            anchor: {
                kind: 'range',
                filePath: 'src/range.ts',
                startLine: 2,
                endLine: 3,
                startLineHash: computeLineContentHash('first();'),
                endLineHash: computeLineContentHash('second();'),
                selectedTextHash: computeLineContentHash('first();\nsecond();'),
            },
        });
        expect(draft.snapshot).toEqual({
            selectedLines: ['first();', 'second();'],
            beforeContext: ['before();'],
            afterContext: ['after();'],
        });
    });

    it('builds a normalized file range anchor and snapshot for rendered markdown source ranges', () => {
        const draft = buildReviewCommentDraftFromMarkdownRange({
            filePath: 'docs/plan.md',
            markdown: ['# Title', '', 'First paragraph', 'Second paragraph', '', 'After'].join('\n'),
            sourceRange: { startLine: 3, endLine: 4 },
            body: 'Clarify this section',
            contextRadius: 1,
            nowMs: 987,
            id: 'm1',
        });

        expect(draft).toMatchObject({
            id: 'm1',
            filePath: 'docs/plan.md',
            source: 'file',
            createdAt: 987,
            body: 'Clarify this section',
            anchor: {
                kind: 'range',
                filePath: 'docs/plan.md',
                startLine: 3,
                endLine: 4,
                startLineHash: computeLineContentHash('First paragraph'),
                endLineHash: computeLineContentHash('Second paragraph'),
                selectedTextHash: computeLineContentHash('First paragraph\nSecond paragraph'),
            },
        });
        expect(draft.snapshot).toEqual({
            selectedLines: ['First paragraph', 'Second paragraph'],
            beforeContext: ['# Title'],
            afterContext: ['After'],
        });
    });
});
