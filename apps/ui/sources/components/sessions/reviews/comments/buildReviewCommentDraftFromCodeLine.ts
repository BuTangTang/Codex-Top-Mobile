import type { CodeLine } from '@/components/ui/code/model/codeLineTypes';
import type { MarkdownSourceRange } from '@/components/markdown/MarkdownView';
import { randomUUID } from '@/platform/randomUUID';
import type {
    ReviewCommentAnchor,
    ReviewCommentDraft,
    ReviewCommentSnapshot,
    ReviewCommentSource,
} from '@/sync/domains/input/reviewComments/reviewCommentTypes';
import { nowServerMs } from '@/sync/runtime/time';
import { computeLineContentHash } from '@/utils/text/lineContentHash';

export function formatReviewCommentCodeLineContent(params: { source: ReviewCommentSource; line: CodeLine }): string {
    if (params.source === 'diff') {
        const prefix = params.line.renderPrefixText ?? '';
        const code = params.line.renderCodeText ?? '';
        return `${prefix}${code}`;
    }
    return params.line.renderCodeText ?? '';
}

export function formatReviewCommentCodeLineDisplayText(params: { source: ReviewCommentSource; line: CodeLine }): string {
    return formatReviewCommentCodeLineContent(params).trimEnd();
}

function buildAnchor(params: { filePath: string; source: ReviewCommentSource; line: CodeLine }): ReviewCommentAnchor {
    const lineHash = computeLineContentHash(formatReviewCommentCodeLineContent(params));

    if (params.source === 'file') {
        const line = typeof params.line.newLine === 'number' && params.line.newLine > 0
            ? params.line.newLine
            : params.line.sourceIndex + 1;
        return { kind: 'line', filePath: params.filePath, line, lineHash };
    }

    const side: 'before' | 'after' = params.line.kind === 'remove' ? 'before' : 'after';
    const line = side === 'before'
        ? (typeof params.line.oldLine === 'number' && params.line.oldLine > 0 ? params.line.oldLine : params.line.sourceIndex + 1)
        : (typeof params.line.newLine === 'number' && params.line.newLine > 0 ? params.line.newLine : params.line.sourceIndex + 1);
    return {
        kind: 'line',
        filePath: params.filePath,
        line,
        side,
        lineHash,
    };
}

function resolveAnchorLineNumber(params: { source: ReviewCommentSource; line: CodeLine; side?: 'before' | 'after' }): number {
    if (params.source === 'file') {
        return typeof params.line.newLine === 'number' && params.line.newLine > 0
            ? params.line.newLine
            : params.line.sourceIndex + 1;
    }
    const side = params.side ?? (params.line.kind === 'remove' ? 'before' : 'after');
    return side === 'before'
        ? (typeof params.line.oldLine === 'number' && params.line.oldLine > 0 ? params.line.oldLine : params.line.sourceIndex + 1)
        : (typeof params.line.newLine === 'number' && params.line.newLine > 0 ? params.line.newLine : params.line.sourceIndex + 1);
}

function buildRangeAnchor(params: { filePath: string; source: ReviewCommentSource; targetLines: readonly CodeLine[] }): ReviewCommentAnchor {
    const first = params.targetLines[0];
    const last = params.targetLines[params.targetLines.length - 1];
    if (!first || !last) {
        return {
            kind: 'range',
            filePath: params.filePath,
            startLine: 1,
            endLine: 1,
        };
    }

    const side: 'before' | 'after' | undefined = params.source === 'diff'
        ? (first.kind === 'remove' ? 'before' : 'after')
        : undefined;
    const startLine = resolveAnchorLineNumber({ source: params.source, line: first, side });
    const endLine = resolveAnchorLineNumber({ source: params.source, line: last, side });
    const selectedLines = params.targetLines.map((line) => formatReviewCommentCodeLineContent({
        source: params.source,
        line,
    }));

    return {
        kind: 'range',
        filePath: params.filePath,
        startLine: Math.min(startLine, endLine),
        endLine: Math.max(startLine, endLine),
        ...(side ? { side } : null),
        startLineHash: computeLineContentHash(formatReviewCommentCodeLineContent({ source: params.source, line: first })),
        endLineHash: computeLineContentHash(formatReviewCommentCodeLineContent({ source: params.source, line: last })),
        selectedTextHash: computeLineContentHash(selectedLines.join('\n')),
    };
}

function buildSnapshot(params: {
    source: ReviewCommentSource;
    lines: readonly CodeLine[];
    targetIndex: number;
    contextRadius: number;
}): ReviewCommentSnapshot {
    const before: string[] = [];
    const after: string[] = [];

    for (let i = params.targetIndex - 1; i >= 0 && before.length < params.contextRadius; i--) {
        const line = params.lines[i];
        if (!line || line.renderIsHeaderLine) continue;
        before.unshift(formatReviewCommentCodeLineDisplayText({ source: params.source, line }));
    }
    for (let i = params.targetIndex + 1; i < params.lines.length && after.length < params.contextRadius; i++) {
        const line = params.lines[i];
        if (!line || line.renderIsHeaderLine) continue;
        after.push(formatReviewCommentCodeLineDisplayText({ source: params.source, line }));
    }

    const selected = params.lines[params.targetIndex];
    const selectedLines = selected && !selected.renderIsHeaderLine
        ? [formatReviewCommentCodeLineDisplayText({ source: params.source, line: selected })]
        : [];

    return {
        selectedLines,
        beforeContext: before,
        afterContext: after,
    };
}

function buildRangeSnapshot(params: {
    source: ReviewCommentSource;
    lines: readonly CodeLine[];
    targetIndexes: readonly number[];
    contextRadius: number;
}): ReviewCommentSnapshot {
    const sortedIndexes = [...params.targetIndexes].filter((index) => index >= 0).sort((a, b) => a - b);
    const firstIndex = sortedIndexes[0] ?? 0;
    const lastIndex = sortedIndexes[sortedIndexes.length - 1] ?? firstIndex;
    const selectedIndexSet = new Set(sortedIndexes);
    const before: string[] = [];
    const after: string[] = [];

    for (let i = firstIndex - 1; i >= 0 && before.length < params.contextRadius; i--) {
        const line = params.lines[i];
        if (!line || line.renderIsHeaderLine) continue;
        before.unshift(formatReviewCommentCodeLineDisplayText({ source: params.source, line }));
    }
    for (let i = lastIndex + 1; i < params.lines.length && after.length < params.contextRadius; i++) {
        const line = params.lines[i];
        if (!line || line.renderIsHeaderLine) continue;
        after.push(formatReviewCommentCodeLineDisplayText({ source: params.source, line }));
    }

    const selectedLines = sortedIndexes
        .filter((index) => selectedIndexSet.has(index))
        .map((index) => params.lines[index])
        .filter((line): line is CodeLine => Boolean(line) && !line.renderIsHeaderLine)
        .map((line) => formatReviewCommentCodeLineDisplayText({ source: params.source, line }));

    return {
        selectedLines,
        beforeContext: before,
        afterContext: after,
    };
}

export function buildReviewCommentDraftFromCodeLine(params: {
    filePath: string;
    source: ReviewCommentSource;
    lines: readonly CodeLine[];
    targetLine: CodeLine;
    body: string;
    contextRadius: number;
    existing?: Pick<ReviewCommentDraft, 'id' | 'createdAt'> | null;
    nowMs?: number;
    id?: string;
}): ReviewCommentDraft {
    const idx = params.lines.findIndex((l) => l.id === params.targetLine.id);
    const targetIndex = idx >= 0 ? idx : 0;

    const anchor = buildAnchor({ filePath: params.filePath, source: params.source, line: params.targetLine });
    const snapshot = buildSnapshot({
        source: params.source,
        lines: params.lines,
        targetIndex,
        contextRadius: params.contextRadius,
    });

    const id = params.existing?.id ?? params.id ?? randomUUID();
    const createdAt = params.existing?.createdAt ?? params.nowMs ?? nowServerMs();

    return {
        id,
        filePath: params.filePath,
        source: params.source,
        anchor,
        snapshot,
        body: params.body,
        createdAt,
    };
}

export function buildReviewCommentDraftFromCodeLineRange(params: {
    filePath: string;
    source: ReviewCommentSource;
    lines: readonly CodeLine[];
    targetLines: readonly CodeLine[];
    body: string;
    contextRadius: number;
    existing?: Pick<ReviewCommentDraft, 'id' | 'createdAt'> | null;
    nowMs?: number;
    id?: string;
}): ReviewCommentDraft {
    const targetIndexes = params.targetLines.map((targetLine) => params.lines.findIndex((line) => line.id === targetLine.id));
    const targetLines = targetIndexes
        .map((index) => params.lines[index])
        .filter((line): line is CodeLine => Boolean(line) && !line.renderIsHeaderLine);
    const effectiveTargetLines = targetLines.length > 0 ? targetLines : params.targetLines;

    const anchor = buildRangeAnchor({
        filePath: params.filePath,
        source: params.source,
        targetLines: effectiveTargetLines,
    });
    const snapshot = buildRangeSnapshot({
        source: params.source,
        lines: params.lines,
        targetIndexes,
        contextRadius: params.contextRadius,
    });

    const id = params.existing?.id ?? params.id ?? randomUUID();
    const createdAt = params.existing?.createdAt ?? params.nowMs ?? nowServerMs();

    return {
        id,
        filePath: params.filePath,
        source: params.source,
        anchor,
        snapshot,
        body: params.body,
        createdAt,
    };
}

function readMarkdownSourceLines(markdown: string, range: MarkdownSourceRange): readonly string[] {
    const lines = markdown.split('\n');
    const start = Math.max(1, Math.floor(range.startLine));
    const end = Math.max(start, Math.floor(range.endLine));
    return lines.slice(start - 1, end);
}

function buildMarkdownSnapshot(params: {
    markdown: string;
    sourceRange: MarkdownSourceRange;
    contextRadius: number;
}): ReviewCommentSnapshot {
    const lines = params.markdown.split('\n');
    const startIndex = Math.max(0, Math.floor(params.sourceRange.startLine) - 1);
    const endIndex = Math.max(startIndex, Math.floor(params.sourceRange.endLine) - 1);
    const selectedLines = lines.slice(startIndex, endIndex + 1).filter((line) => line.trim().length > 0);
    const beforeContext: string[] = [];
    const afterContext: string[] = [];

    for (let index = startIndex - 1; index >= 0 && beforeContext.length < params.contextRadius; index--) {
        const line = lines[index] ?? '';
        if (line.trim().length === 0) continue;
        beforeContext.unshift(line);
    }
    for (let index = endIndex + 1; index < lines.length && afterContext.length < params.contextRadius; index++) {
        const line = lines[index] ?? '';
        if (line.trim().length === 0) continue;
        afterContext.push(line);
    }

    return {
        selectedLines,
        beforeContext,
        afterContext,
    };
}

export function buildReviewCommentDraftFromMarkdownRange(params: {
    filePath: string;
    markdown: string;
    sourceRange: MarkdownSourceRange;
    body: string;
    contextRadius: number;
    existing?: Pick<ReviewCommentDraft, 'id' | 'createdAt'> | null;
    nowMs?: number;
    id?: string;
}): ReviewCommentDraft {
    const selectedLines = readMarkdownSourceLines(params.markdown, params.sourceRange);
    const firstLine = selectedLines[0] ?? '';
    const lastLine = selectedLines[selectedLines.length - 1] ?? firstLine;
    const selectedText = selectedLines.join('\n');
    const id = params.existing?.id ?? params.id ?? randomUUID();
    const createdAt = params.existing?.createdAt ?? params.nowMs ?? nowServerMs();

    return {
        id,
        filePath: params.filePath,
        source: 'file',
        anchor: {
            kind: 'range',
            filePath: params.filePath,
            startLine: params.sourceRange.startLine,
            endLine: params.sourceRange.endLine,
            startLineHash: computeLineContentHash(firstLine),
            endLineHash: computeLineContentHash(lastLine),
            selectedTextHash: computeLineContentHash(selectedText),
        },
        snapshot: buildMarkdownSnapshot({
            markdown: params.markdown,
            sourceRange: params.sourceRange,
            contextRadius: params.contextRadius,
        }),
        body: params.body,
        createdAt,
    };
}
