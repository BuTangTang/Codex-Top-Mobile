/**
 * Minimal view of a pending turn's compaction state needed to decide how a post-compaction pause
 * should settle. Kept narrow (not the whole `PendingTurn`) so the decision is pure and easy to test.
 */
export type PiCompactionTurnState = {
  /** Last observed `compaction_end` for the turn, or `null` if none was seen. */
  readonly lastCompactionEnd: {
    readonly willRetry: boolean;
    readonly errorMessage: string | null;
  } | null;
  /** Stop reason of the last assistant `message_end` observed before the post-turn compaction. */
  readonly lastAssistantStopReason: string | null;
};

/**
 * How a Pi turn should settle once a compaction pause is being resolved.
 *
 * - `completed_post_final`: the final assistant answer already completed (`stopReason === 'stop'`);
 *   the turn resolves completed/non-fatal and must NEVER escalate into runtime-auth recovery, even
 *   when the post-final maintenance compaction failed with an auth/capacity-classifiable error.
 * - `terminal_failure`: a compaction dependency failure interrupted genuinely unfinished work; the
 *   turn must fail-closed and surface actionable diagnostics (carries the terminal error message).
 * - `pause`: an ordinary threshold/manual/overflow compaction pause that is neither a completed
 *   final answer nor a terminal failure; the caller settles it as a paused compaction.
 */
export type PiCompactionTurnOutcome =
  | { readonly kind: 'completed_post_final' }
  | { readonly kind: 'terminal_failure'; readonly detail: string }
  | { readonly kind: 'pause' };
