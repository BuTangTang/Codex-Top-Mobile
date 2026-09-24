import { describe, expect, it } from 'vitest';

import { parseMarkdownBlock } from './parseMarkdownBlock';

describe('parseMarkdownBlock source ranges', () => {
    it('preserves source line ranges for headers, paragraphs, lists, and fenced code blocks when requested', () => {
        const blocks = parseMarkdownBlock([
            '# Title',
            '',
            'First paragraph',
            '- one',
            '- two',
            '',
            '```ts',
            'const value = 1;',
            '```',
        ].join('\n'), { includeSourceRanges: true });

        expect(blocks.map((block) => block.sourceRange)).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 3, endLine: 3 },
            { startLine: 4, endLine: 5 },
            { startLine: 7, endLine: 9 },
        ]);
        expect(blocks[2]?.type).toBe('list');
        if (blocks[2]?.type === 'list') {
            expect(blocks[2].items.map((item) => item.sourceRange)).toEqual([
                { startLine: 4, endLine: 4 },
                { startLine: 5, endLine: 5 },
            ]);
        }
    });

    it('preserves source line ranges for tables and option blocks when requested', () => {
        const blocks = parseMarkdownBlock([
            '| A | B |',
            '| - | - |',
            '| 1 | 2 |',
            '',
            '<options>',
            '<option>Ship it</option>',
            '</options>',
        ].join('\n'), { includeSourceRanges: true });

        expect(blocks.map((block) => block.sourceRange)).toEqual([
            { startLine: 1, endLine: 3 },
            { startLine: 5, endLine: 7 },
        ]);
    });
});
