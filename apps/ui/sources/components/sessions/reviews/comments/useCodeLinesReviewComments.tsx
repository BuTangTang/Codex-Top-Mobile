import * as React from 'react';
import { View } from 'react-native';

import type { CodeLine } from '@/components/ui/code/model/codeLineTypes';
import { t } from '@/text';
import type { ReviewCommentDraft, ReviewCommentSource } from '@/sync/domains/input/reviewComments/reviewCommentTypes';
import { computeLineContentHash, findLineIndexByContentHash, type LineContentHash } from '@/utils/text/lineContentHash';

import {
    buildReviewCommentDraftFromCodeLine,
    buildReviewCommentDraftFromCodeLineRange,
    formatReviewCommentCodeLineContent,
} from './buildReviewCommentDraftFromCodeLine';
import { ReviewCommentInlineComposer } from './ReviewCommentInlineComposer';
import { ReviewCommentSavedDrafts } from './ReviewCommentSavedDrafts';

function isLineCandidateForDraft(params: { source: ReviewCommentSource; draft: ReviewCommentDraft; line: CodeLine }): boolean {
    if (params.draft.source !== params.source) return false;
    if (params.source !== 'diff') return true;
    if (params.draft.anchor.kind !== 'diffLine' && params.draft.anchor.kind !== 'line' && params.draft.anchor.kind !== 'range') return true;
    const side = params.line.kind === 'remove' ? 'before' : 'after';
    return side === params.draft.anchor.side;
}

function getDraftLineHash(draft: ReviewCommentDraft): LineContentHash | undefined {
    if (draft.anchor.kind === 'range') return draft.anchor.startLineHash;
    return draft.anchor.lineHash;
}

function isExactLineMatchForDraft(params: {
    source: ReviewCommentSource;
    draft: ReviewCommentDraft;
    line: CodeLine;
}): boolean {
    const anchor = params.draft.anchor;
    if (params.source === 'file') {
        const lineNumber = typeof params.line.newLine === 'number' ? params.line.newLine : params.line.sourceIndex + 1;
        if (anchor.kind === 'fileLine') return lineNumber === anchor.startLine;
        if (anchor.kind === 'line') return lineNumber === anchor.line;
        if (anchor.kind === 'range') return lineNumber === anchor.startLine;
        return false;
    }

    if (anchor.kind === 'diffLine') {
        const side = params.line.kind === 'remove' ? 'before' : 'after';
        return side === anchor.side && (params.line.sourceIndex + 1) === anchor.startLine;
    }

    if (anchor.kind === 'line' || anchor.kind === 'range') {
        const side = anchor.side === 'before' ? 'before' : 'after';
        const lineNumber = anchor.kind === 'line' ? anchor.line : anchor.startLine;
        if (side === 'before') return typeof params.line.oldLine === 'number' && params.line.oldLine === lineNumber;
        return typeof params.line.newLine === 'number' && params.line.newLine === lineNumber;
    }

    return false;
}

function buildDraftsByResolvedLineId(params: Readonly<{
    filePath: string;
    source: ReviewCommentSource;
    lines: readonly CodeLine[];
    drafts: readonly ReviewCommentDraft[];
}>): Map<string, ReviewCommentDraft[]> {
    const map = new Map<string, ReviewCommentDraft[]>();
    for (const draft of params.drafts) {
        if (draft.filePath !== params.filePath || draft.source !== params.source) continue;

        let lineId: string | null = null;
        const exactLine = params.lines.find((line) => isExactLineMatchForDraft({
            source: params.source,
            draft,
            line,
        })) ?? null;
        if (exactLine) {
            const lineHash = getDraftLineHash(draft);
            const exactLineMatchesHash = !lineHash || (
                computeLineContentHash(formatReviewCommentCodeLineContent({
                    source: params.source,
                    line: exactLine,
                })) === lineHash
            );
            if (exactLineMatchesHash) {
                lineId = exactLine.id;
            }
        }
        const lineHash = getDraftLineHash(draft);
        if (!lineId && lineHash) {
            const index = findLineIndexByContentHash({
                lines: params.lines,
                lineHash,
                isCandidate: (line) => isLineCandidateForDraft({
                    source: params.source,
                    draft,
                    line,
                }),
                getLineContent: (line) => formatReviewCommentCodeLineContent({
                    source: params.source,
                    line,
                }),
            });
            lineId = index >= 0 ? params.lines[index]?.id ?? null : null;
        }
        if (!lineId) continue;

        const existing = map.get(lineId);
        if (existing) existing.push(draft);
        else map.set(lineId, [draft]);
    }

    return map;
}

function resolveLineNumberForRangeComparison(params: Readonly<{
    source: ReviewCommentSource;
    line: CodeLine;
    side?: 'before' | 'after';
}>): number | null {
    if (params.source === 'file') {
        if (typeof params.line.newLine === 'number' && params.line.newLine > 0) return params.line.newLine;
        return params.line.sourceIndex + 1;
    }

    const side = params.side ?? (params.line.kind === 'remove' ? 'before' : 'after');
    if (side === 'before') {
        return typeof params.line.oldLine === 'number' && params.line.oldLine > 0 ? params.line.oldLine : null;
    }
    return typeof params.line.newLine === 'number' && params.line.newLine > 0 ? params.line.newLine : null;
}

function resolveDraftRangeLines(params: Readonly<{
    source: ReviewCommentSource;
    lines: readonly CodeLine[];
    draft: ReviewCommentDraft;
    fallbackLine: CodeLine;
}>): readonly CodeLine[] {
    if (params.draft.anchor.kind !== 'range') return [params.fallbackLine];
    const start = Math.min(params.draft.anchor.startLine, params.draft.anchor.endLine);
    const end = Math.max(params.draft.anchor.startLine, params.draft.anchor.endLine);
    const side = params.draft.anchor.side;
    const rangeLines = params.lines.filter((line) => {
        if (line.renderIsHeaderLine) return false;
        if (params.source === 'diff' && side) {
            const lineSide = line.kind === 'remove' ? 'before' : 'after';
            if (lineSide !== side) return false;
        }
        const lineNumber = resolveLineNumberForRangeComparison({
            source: params.source,
            line,
            side,
        });
        return typeof lineNumber === 'number' && lineNumber >= start && lineNumber <= end;
    });
    return rangeLines.length > 0 ? rangeLines : [params.fallbackLine];
}

export function useCodeLinesReviewComments(params: {
    enabled: boolean;
    filePath: string;
    source: ReviewCommentSource;
    lines: readonly CodeLine[];
    drafts: readonly ReviewCommentDraft[];
    contextRadius?: number;
    onUpsertDraft?: (draft: ReviewCommentDraft) => void;
    onDeleteDraft?: (commentId: string) => void;
    onError?: (message: string) => void;
}): {
    onPressAddComment: (line: CodeLine) => void;
    onPressAddCommentRange: (lines: readonly CodeLine[]) => void;
    renderAfterLine: (line: CodeLine) => React.ReactNode;
    isCommentActive: (line: CodeLine) => boolean;
} | null {
    const enabled = params.enabled;
    const filePath = params.filePath;
    const source = params.source;
    const lines = params.lines;
    const drafts = params.drafts;
    const contextRadius = params.contextRadius ?? 2;
    const onUpsertDraft = params.onUpsertDraft;
    const onDeleteDraft = params.onDeleteDraft;
    const onError = params.onError;

    const [activeCommentLineId, setActiveCommentLineId] = React.useState<string | null>(null);
    const [activeCommentRangeLineIds, setActiveCommentRangeLineIds] = React.useState<readonly string[]>([]);
    const [activeEditingDraftId, setActiveEditingDraftId] = React.useState<string | null>(null);
    const [commentBody, setCommentBody] = React.useState('');

    const draftsByLineId = React.useMemo(() => buildDraftsByResolvedLineId({
        filePath,
        source,
        lines,
        drafts,
    }), [drafts, filePath, lines, source]);

    const isCommentActive = React.useCallback((line: CodeLine): boolean => {
        if (!enabled) return false;
        if (line.renderIsHeaderLine) return false;
        return activeCommentLineId === line.id;
    }, [activeCommentLineId, enabled]);

    const onPressAddComment = React.useCallback((line: CodeLine) => {
        if (!enabled) return;
        if (line.renderIsHeaderLine) return;

        const existingDraft = (draftsByLineId.get(line.id) ?? [])[0] ?? null;
        setActiveCommentLineId((prev) => (prev === line.id ? null : line.id));
        setActiveCommentRangeLineIds([line.id]);
        setActiveEditingDraftId(existingDraft?.id ?? null);
        setCommentBody(existingDraft?.body ?? '');
    }, [draftsByLineId, enabled]);

    const onPressAddCommentRange = React.useCallback((targetLines: readonly CodeLine[]) => {
        if (!enabled) return;
        const selectedLines = targetLines.filter((line) => !line.renderIsHeaderLine);
        const lastLine = selectedLines[selectedLines.length - 1];
        if (!lastLine) return;
        setActiveCommentLineId(lastLine.id);
        setActiveCommentRangeLineIds(selectedLines.map((line) => line.id));
        setActiveEditingDraftId(null);
        setCommentBody('');
    }, [enabled]);

    const startEditingDraft = React.useCallback((line: CodeLine, draft: ReviewCommentDraft) => {
        if (!enabled) return;
        if (line.renderIsHeaderLine) return;
        const draftRangeLines = resolveDraftRangeLines({
            source,
            lines,
            draft,
            fallbackLine: line,
        });
        setActiveCommentLineId(line.id);
        setActiveCommentRangeLineIds(draftRangeLines.map((rangeLine) => rangeLine.id));
        setActiveEditingDraftId(draft.id);
        setCommentBody(draft.body);
    }, [enabled, lines, source]);

    const renderAfterLine = React.useCallback((line: CodeLine) => {
        if (!enabled) return null;
        if (line.renderIsHeaderLine) return null;

        const drafts = draftsByLineId.get(line.id) ?? [];

        const isActive = activeCommentLineId === line.id;
        if (!isActive && drafts.length === 0) return null;

        const existing = activeEditingDraftId
            ? drafts.find((d) => d.id === activeEditingDraftId) ?? null
            : null;

        return (
            <View>
                {drafts.length > 0 && !isActive ? (
                    <ReviewCommentSavedDrafts
                        drafts={drafts}
                        onEditDraft={(draft) => startEditingDraft(line, draft)}
                        onDeleteDraft={onDeleteDraft}
                        style={{ marginLeft: 0, marginRight: 8, marginTop: 6, gap: 6 }}
                        testID={`review-comment-saved-drafts:${line.id}`}
                    />
                ) : null}

                {isActive ? (
                    <ReviewCommentInlineComposer
                        value={commentBody}
                        onChange={setCommentBody}
                        onCancel={() => {
                            setActiveCommentLineId(null);
                            setActiveCommentRangeLineIds([]);
                            setActiveEditingDraftId(null);
                            setCommentBody('');
                        }}
                        onDelete={existing ? () => {
                            onDeleteDraft?.(existing.id);
                            setActiveCommentLineId(null);
                            setActiveCommentRangeLineIds([]);
                            setActiveEditingDraftId(null);
                            setCommentBody('');
                        } : undefined}
                        onSave={() => {
                            const body = commentBody.trim();
                            if (!body) {
                                onError?.(t('files.reviewComments.errors.empty'));
                                return;
                            }

                            const activeRangeLines = activeCommentRangeLineIds
                                .map((id) => lines.find((candidate) => candidate.id === id) ?? null)
                                .filter((candidate): candidate is CodeLine => Boolean(candidate));
                            const shouldSaveRangeDraft = activeRangeLines.length > 1 && (!existing || existing.anchor.kind === 'range');
                            const draft = shouldSaveRangeDraft
                                ? buildReviewCommentDraftFromCodeLineRange({
                                    filePath,
                                    source,
                                    lines,
                                    targetLines: activeRangeLines,
                                    body,
                                    contextRadius,
                                    existing: existing ? { id: existing.id, createdAt: existing.createdAt } : null,
                                })
                                : buildReviewCommentDraftFromCodeLine({
                                    filePath,
                                    source,
                                    lines,
                                    targetLine: line,
                                    body,
                                    contextRadius,
                                    existing: existing ? { id: existing.id, createdAt: existing.createdAt } : null,
                                });
                            onUpsertDraft?.(draft);
                            setActiveCommentLineId(null);
                            setActiveCommentRangeLineIds([]);
                            setActiveEditingDraftId(null);
                            setCommentBody('');
                        }}
                    />
                ) : null}
            </View>
        );
    }, [
        activeCommentLineId,
        activeCommentRangeLineIds,
        activeEditingDraftId,
        commentBody,
        contextRadius,
        draftsByLineId,
        enabled,
        filePath,
        lines,
        onDeleteDraft,
        onError,
        onUpsertDraft,
        source,
        startEditingDraft,
    ]);

    if (!enabled) return null;
    return { onPressAddComment, onPressAddCommentRange, renderAfterLine, isCommentActive };
}
