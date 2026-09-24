import * as React from 'react';

import type { TranscriptItemHeightValiditySignature } from './transcriptItemHeightCache';

export type TranscriptRowLayoutMutationReason = 'expand' | 'collapse' | 'signature-change';

export type TranscriptRowLayoutMutation = Readonly<{
    reason: TranscriptRowLayoutMutationReason;
    sourceId: string;
    /**
     * C1: the signature pair for a `signature-change` mutation. The host hands this to the
     * measurement reconciler's transaction-gated `requestGlobalLayoutInvalidation` so the global
     * `clearLayoutCacheOnUpdate` fires only on a real structural delta (never on append) and never
     * while a prepend/entry-restore transaction owns the viewport.
     */
    previousSignature?: TranscriptItemHeightValiditySignature;
    nextSignature?: TranscriptItemHeightValiditySignature;
}>;

export type TranscriptRowLayoutMutationHandler = (mutation: TranscriptRowLayoutMutation) => void;

const TranscriptRowLayoutMutationContext = React.createContext<TranscriptRowLayoutMutationHandler | null>(null);

export const TranscriptRowLayoutMutationProvider = TranscriptRowLayoutMutationContext.Provider;

export function useTranscriptRowLayoutMutation(): TranscriptRowLayoutMutationHandler {
    const handler = React.useContext(TranscriptRowLayoutMutationContext);
    return React.useCallback((mutation: TranscriptRowLayoutMutation) => {
        handler?.(mutation);
    }, [handler]);
}
