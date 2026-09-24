import { describe, expect, it } from 'vitest';

import type { CodeLine } from '@/components/ui/code/model/codeLineTypes';

import { buildCodeLineRange, isCodeLineRangeSelectionEvent } from './resolveCodeLineRangeSelection';

function line(id: string, header = false): CodeLine {
    return {
        id,
        sourceIndex: Number(id),
        kind: 'context',
        oldLine: Number(id),
        newLine: Number(id),
        renderPrefixText: '',
        renderCodeText: id,
        renderIsHeaderLine: header,
        selectable: true,
    };
}

describe('resolveCodeLineRangeSelection', () => {
    it('builds a contiguous non-header range regardless of drag direction', () => {
        const lines = [line('1'), line('2', true), line('3'), line('4')];

        expect(buildCodeLineRange({ lines, fromLineId: '4', toLineId: '1' }).map((item) => item.id))
            .toEqual(['1', '3', '4']);
    });

    it('returns an empty range when either endpoint is unavailable', () => {
        expect(buildCodeLineRange({ lines: [line('1')], fromLineId: '1', toLineId: 'missing' })).toEqual([]);
    });

    it('detects shift-click from web and React Native Web events', () => {
        expect(isCodeLineRangeSelectionEvent({ shiftKey: true })).toBe(true);
        expect(isCodeLineRangeSelectionEvent({ nativeEvent: { shiftKey: true } })).toBe(true);
        expect(isCodeLineRangeSelectionEvent({ nativeEvent: { shiftKey: false } })).toBe(false);
        expect(isCodeLineRangeSelectionEvent(null)).toBe(false);
    });
});
