/**
 * Constants scoped to the new-session screen-model hooks.
 *
 * Worktree staleness threshold lives here (worktree-scoped, not in the generic
 * SelectionList) because "stale" is a worktree-specific concept derived from
 * `lastActivityAt` and `changeCount` returned by the SCM backend; it is not a
 * universal SelectionList notion.
 */

/**
 * Worktree is rendered as `'stale'` when no activity for this duration AND no
 * pending changes (`changeCount === 0`). Default: 7 days.
 */
export const NEW_SESSION_WORKTREE_STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
