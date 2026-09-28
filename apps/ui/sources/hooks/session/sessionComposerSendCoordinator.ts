import type { SessionDraftTextSnapshot } from './useDraft';

export type ComposerTransientInputStateHandlers<TState> = Readonly<{
    captureTransientInputState: () => TState | null;
    clearTransientInputState: () => void;
    restoreTransientInputState: (state: TState | null) => void;
}>;

export type CapturedComposerTransientInputState<TState> = Readonly<{
    transientInputStateSnapshot: TState | null;
    clearTransientInputState: () => void;
    restoreTransientInputState: () => void;
}>;

export function captureComposerTransientInputStateForOutboundHandoff<TState>({
    captureTransientInputState,
    clearTransientInputState,
    restoreTransientInputState,
}: ComposerTransientInputStateHandlers<TState>): CapturedComposerTransientInputState<TState> {
    const transientInputStateSnapshot = captureTransientInputState();

    return {
        transientInputStateSnapshot,
        clearTransientInputState,
        restoreTransientInputState: () => {
            restoreTransientInputState(transientInputStateSnapshot);
        },
    };
}

export type OutboundHandoffComposerClearParams = Readonly<{
    snapshot: SessionDraftTextSnapshot;
    clearDraftForSessionIfCurrentValueMatches: (snapshot: SessionDraftTextSnapshot) => boolean;
    clearTransientInputState: () => void;
    isSemanticSnapshotCurrent?: () => boolean;
    clearSemanticDraftValues?: () => void;
}>;

export type FailedOutboundHandoffRestoreParams = Readonly<{
    snapshot: SessionDraftTextSnapshot;
    wasClearedAtHandoff: boolean;
    isCanonicalOutboundHandoffPresent: () => boolean;
    isSemanticRestoreSafe?: () => boolean;
    restoreDraftForSessionIfCurrentValueMatches: (
        snapshot: SessionDraftTextSnapshot,
        expectedCurrentValue: string,
    ) => boolean;
    restoreTransientInputState?: () => void;
    restoreSemanticDraftValues?: () => void;
}>;

export function clearComposerAfterOutboundHandoff({
    snapshot,
    clearDraftForSessionIfCurrentValueMatches,
    clearTransientInputState,
    isSemanticSnapshotCurrent,
    clearSemanticDraftValues,
}: OutboundHandoffComposerClearParams): boolean {
    if (isSemanticSnapshotCurrent && !isSemanticSnapshotCurrent()) {
        return false;
    }

    const didClearDraft = clearDraftForSessionIfCurrentValueMatches(snapshot);
    if (!didClearDraft) return false;

    clearSemanticDraftValues?.();
    clearTransientInputState();
    return true;
}

export function restoreComposerAfterFailedOutboundHandoff({
    snapshot,
    wasClearedAtHandoff,
    isCanonicalOutboundHandoffPresent,
    isSemanticRestoreSafe,
    restoreDraftForSessionIfCurrentValueMatches,
    restoreTransientInputState,
    restoreSemanticDraftValues,
}: FailedOutboundHandoffRestoreParams): boolean {
    if (!wasClearedAtHandoff) return false;
    if (isCanonicalOutboundHandoffPresent()) return false;
    if (isSemanticRestoreSafe && !isSemanticRestoreSafe()) {
        return false;
    }

    const didRestoreDraft = restoreDraftForSessionIfCurrentValueMatches(snapshot, '');
    if (!didRestoreDraft) return false;

    restoreSemanticDraftValues?.();
    restoreTransientInputState?.();
    return true;
}

/** The draft owner must have cleared the captured text before dispatching this native optimization. */
export function clearNativeInputAfterOutboundHandoff(params: Readonly<{
    snapshot: SessionDraftTextSnapshot;
    beforeClear: SessionDraftTextSnapshot | null;
    afterClear: SessionDraftTextSnapshot | null;
    didClear: boolean;
    input: { clearIfTextMatches: (expectedText: string) => boolean } | null;
}>): boolean {
    const { snapshot, beforeClear, afterClear, didClear, input } = params;
    const capturedTextMutation = snapshot.currentness?.mutationIds['composer.text'];
    const afterTextMutation = afterClear?.currentness?.mutationIds['composer.text'];
    if (!didClear || !capturedTextMutation || !afterClear?.currentness || !snapshot.scope) return false;
    if (beforeClear?.sessionId !== snapshot.sessionId || afterClear?.sessionId !== snapshot.sessionId) return false;
    if (beforeClear.scope?.serverId !== snapshot.scope.serverId || afterClear.scope?.serverId !== snapshot.scope.serverId
        || beforeClear.scope?.accountId !== snapshot.scope.accountId || afterClear.scope?.accountId !== snapshot.scope.accountId) return false;
    if (beforeClear.currentness?.mutationIds['composer.text'] !== capturedTextMutation
        || afterTextMutation === capturedTextMutation || afterClear.text !== '') return false;
    return input?.clearIfTextMatches(snapshot.text) ?? false;
}
