import type { CodeLine } from '@/components/ui/code/model/codeLineTypes';

export function buildCodeLineRange(params: Readonly<{
    lines: readonly CodeLine[];
    fromLineId: string;
    toLineId: string;
}>): readonly CodeLine[] {
    const fromIndex = params.lines.findIndex((line) => line.id === params.fromLineId);
    const toIndex = params.lines.findIndex((line) => line.id === params.toLineId);
    if (fromIndex < 0 || toIndex < 0) return [];

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    return params.lines.slice(start, end + 1).filter((line) => !line.renderIsHeaderLine);
}

export function isCodeLineRangeSelectionEvent(event: unknown): boolean {
    if (!event || typeof event !== 'object') return false;
    const record = event as { shiftKey?: unknown; nativeEvent?: unknown };
    if (record.shiftKey === true) return true;
    if (!record.nativeEvent || typeof record.nativeEvent !== 'object') return false;
    return (record.nativeEvent as { shiftKey?: unknown }).shiftKey === true;
}
