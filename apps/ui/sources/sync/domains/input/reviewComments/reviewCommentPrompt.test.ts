import { describe, expect, it } from 'vitest';

import {
    buildReviewCommentsDisplayText,
    buildReviewCommentsPromptText,
    filterReviewCommentDraftsIncludedInPrompt,
} from './reviewCommentPrompt';
import type { ReviewCommentDraft } from './reviewCommentTypes';

describe('reviewCommentPrompt', () => {
    it('builds a prompt block that is usable with no additional user message', () => {
        const drafts: ReviewCommentDraft[] = [
            {
                id: 'c1',
                filePath: 'src/a.ts',
                source: 'diff',
                anchor: { kind: 'diffLine', side: 'after', oldLine: null, newLine: 42, startLine: 10, lineHash: 'lh1:1234567890abcdef' },
                snapshot: { selectedLines: ['const x = 1;'], beforeContext: [], afterContext: [] },
                body: 'Please rename x to count',
                createdAt: 1,
            },
        ];

        const prompt = buildReviewCommentsPromptText({
            sessionId: 's1',
            drafts,
            additionalMessage: '',
        });

        expect(prompt).toContain('Review comments');
        expect(prompt).toContain('src/a.ts');
        expect(prompt).toContain('after');
        expect(prompt).toContain('42');
        expect(prompt).toContain('lh1:1234567890abcdef');
        expect(prompt).toContain('Please rename x to count');
        expect(prompt).toContain('const x = 1;');
    });

    it('builds a compact display text summary', () => {
        const drafts: ReviewCommentDraft[] = [
            {
                id: 'c1',
                filePath: 'src/a.ts',
                source: 'file',
                anchor: { kind: 'fileLine', startLine: 1 },
                snapshot: { selectedLines: ['hi'], beforeContext: [], afterContext: [] },
                body: 'nit',
                createdAt: 1,
            },
            {
                id: 'c2',
                filePath: 'src/b.ts',
                source: 'file',
                anchor: { kind: 'fileLine', startLine: 2 },
                snapshot: { selectedLines: ['bye'], beforeContext: [], afterContext: [] },
                body: 'nit2',
                createdAt: 2,
            },
        ];

        expect(buildReviewCommentsDisplayText({ drafts })).toContain('Review comments');
        expect(buildReviewCommentsDisplayText({ drafts })).toContain('2');
    });

    it('filters out drafts detached from the next prompt', () => {
        const drafts: ReviewCommentDraft[] = [
            {
                id: 'c1',
                filePath: 'src/a.ts',
                source: 'file',
                anchor: { kind: 'fileLine', startLine: 1 },
                snapshot: { selectedLines: ['hi'], beforeContext: [], afterContext: [] },
                body: 'send',
                createdAt: 1,
            },
            {
                id: 'c2',
                filePath: 'src/b.ts',
                source: 'file',
                anchor: { kind: 'fileLine', startLine: 2 },
                snapshot: { selectedLines: ['bye'], beforeContext: [], afterContext: [] },
                body: 'keep for later',
                createdAt: 2,
                includeInPrompt: false,
            },
        ];

        expect(filterReviewCommentDraftsIncludedInPrompt(drafts).map((draft) => draft.id)).toEqual(['c1']);
    });

    it('formats normalized range anchors with their side and line range', () => {
        const drafts: ReviewCommentDraft[] = [
            {
                id: 'c1',
                filePath: 'src/a.ts',
                source: 'diff',
                anchor: {
                    kind: 'range',
                    filePath: 'src/a.ts',
                    startLine: 10,
                    endLine: 12,
                    side: 'after',
                    startLineHash: 'lh1:1234567890abcdef',
                    endLineHash: 'lh1:fedcba0987654321',
                },
                snapshot: { selectedLines: ['+a', '+b', '+c'], beforeContext: [], afterContext: [] },
                body: 'Review this range',
                createdAt: 1,
            },
        ];

        const prompt = buildReviewCommentsPromptText({
            sessionId: 's1',
            drafts,
            additionalMessage: '',
        });

        expect(prompt).toContain('after L10-L12');
        expect(prompt).toContain('lh1:1234567890abcdef');
        expect(prompt).toContain('lh1:fedcba0987654321');
    });

    it('includes daemon-resolved anchor details without replacing the original anchor', () => {
        const drafts: ReviewCommentDraft[] = [
            {
                id: 'c1',
                filePath: 'src/a.ts',
                source: 'file',
                anchor: {
                    kind: 'line',
                    filePath: 'src/a.ts',
                    line: 5,
                    lineHash: 'lh1:1234567890abcdef',
                },
                anchorResolution: {
                    id: 'c1',
                    filePath: 'src/a.ts',
                    originalAnchor: {
                        kind: 'line',
                        filePath: 'src/a.ts',
                        line: 5,
                        lineHash: 'lh1:1234567890abcdef',
                    },
                    resolvedAnchor: {
                        kind: 'line',
                        filePath: 'src/a.ts',
                        line: 12,
                        lineHash: 'lh1:fedcba0987654321',
                    },
                    status: 'hash',
                    confidence: 0.85,
                    preview: {
                        beforeContext: ['const before = true;'],
                        selectedLines: ['const moved = true;'],
                        afterContext: ['const after = true;'],
                    },
                },
                snapshot: {
                    selectedLines: ['const original = true;'],
                    beforeContext: [],
                    afterContext: [],
                },
                body: 'Review the moved line',
                createdAt: 1,
            },
        ];

        const prompt = buildReviewCommentsPromptText({
            sessionId: 's1',
            drafts,
            additionalMessage: '',
        });

        expect(prompt).toContain('src/a.ts (L5');
        expect(prompt).toContain('resolved: hash L12');
        expect(prompt).toContain('confidence: 0.85');
        expect(prompt).toContain('const moved = true;');
    });
});
