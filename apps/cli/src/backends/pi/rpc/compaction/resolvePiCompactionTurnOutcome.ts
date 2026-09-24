import type { PiCompactionTurnOutcome, PiCompactionTurnState } from './types';

/**
 * Single source of truth for how a Pi turn settles when a post-compaction pause is resolved.
 *
 * INVARIANT (do not reorder): a turn whose final assistant answer already completed
 * (`lastAssistantStopReason === 'stop'`) resolves completed/non-fatal and is NEVER escalated into
 * runtime-auth recovery — even when the post-final maintenance compaction failed with an
 * auth/capacity-classifiable error. The completed-final check therefore wins over the
 * terminal-failure check. Both `continuePendingTurnAfterCompactionPause` and
 * `resolvePendingTurnAsCompactionPaused` route through here so the ordering cannot drift.
 *
 * A genuinely unfinished turn (no completed final answer) whose compaction dependency failed
 * terminally still fails-closed via `terminal_failure`.
 */
export function resolvePiCompactionTurnOutcome(state: PiCompactionTurnState): PiCompactionTurnOutcome {
  const completedFinalAnswer = state.lastAssistantStopReason === 'stop';
  const end = state.lastCompactionEnd;
  const terminalFailureDetail = end && !end.willRetry && end.errorMessage ? end.errorMessage : null;

  // Completed-final-answer wins: a finished turn must not be escalated regardless of the compaction
  // failure classification.
  if (completedFinalAnswer && end?.willRetry === false) {
    return { kind: 'completed_post_final' };
  }

  if (terminalFailureDetail !== null) {
    return { kind: 'terminal_failure', detail: terminalFailureDetail };
  }

  return { kind: 'pause' };
}
