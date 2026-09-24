/**
 * Per-worktree git status enrichment for `ScmStatusSnapshotResponse`.
 *
 * The default response shape returned by the cli git backend omits per-worktree
 * `changeCount` / `lastActivityAt` so callers that only need branch/path metadata
 * pay no per-worktree git overhead. The new-session worktree picker opts in via
 * the `includeWorktreeStatus` request flag; this module is the only place that
 * does the per-worktree work.
 *
 * Performance contract (mandatory):
 * - Concurrency cap (default 8) — small inline semaphore, no new dependency.
 * - Per-call timeout (default 1500ms) — a slow git invocation falls back to
 *   `undefined` for that field rather than blocking the response.
 * - Graceful omission — any per-worktree failure (timeout, missing path, git
 *   error) leaves both fields `undefined`; the rest of the worktree list is
 *   still returned.
 *
 * Semantics:
 * - `changeCount` counts logical changed entries from `git status --porcelain -z`.
 *   Renames (`R`) and copies (`C`) emit two NUL-separated tokens (`new<NUL>old<NUL>`)
 *   under `-z`, but represent ONE logical change and are counted as 1.
 * - `lastActivityAt` = `max(headCommitTimestampMs, max(workingTreeFileMtimeMs over
 *   tracked dirty files))`. If a tracked file has been modified more recently than
 *   the HEAD commit, that newer mtime is reflected. Untracked-only changes do not
 *   advance the activity timestamp because they are not part of the repo history.
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { ScmWorktree, ScmWorktreeEnrichmentEntry } from '@happier-dev/protocol';

import { runScmCommand } from '../../runtime';

export const DEFAULT_WORKTREE_STATUS_CONCURRENCY = 8;
export const DEFAULT_WORKTREE_STATUS_PER_CALL_TIMEOUT_MS = 1500;
/**
 * FR4-6 — bound the dirty-file mtime scan. After the single `git status --porcelain -z`
 * read, the enricher walks the tracked-dirty entries to compute `lastActivityAt` from
 * their working-tree mtime. Without limits, a worktree with hundreds of dirty files
 * makes the response latency proportional to the dirty count (despite a 1500ms cap on
 * the git call itself). The bounded loop applies three independent guardrails:
 *  - `MAX_ENTRIES` — stop after this many tracked-dirty entries even if more exist.
 *  - `CONCURRENCY` — run a small worker pool to overlap stat() latency.
 *  - `BUDGET_MS` — aggregate wall-clock budget; once exceeded, abort and return
 *    whatever was accumulated so far. The `changeCount` (from porcelain) is unaffected.
 */
export const DEFAULT_DIRTY_FILE_STAT_MAX_ENTRIES = 16;
export const DEFAULT_DIRTY_FILE_STAT_CONCURRENCY = 4;
export const DEFAULT_DIRTY_FILE_STAT_BUDGET_MS = 200;

export type EnrichGitWorktreesWithStatusInput = Readonly<{
    worktrees: ReadonlyArray<ScmWorktree>;
    includeWorktreeStatus: boolean | undefined;
    /** Override the concurrency cap (default 8). Mostly for tests. */
    concurrency?: number;
    /** Override the per-git-call timeout (default 1500ms). Mostly for tests. */
    perCallTimeoutMs?: number;
    /** Override the per-worktree dirty-file stat cap (default 16). Mostly for tests. */
    dirtyFileStatMaxEntries?: number;
    /** Override the dirty-file stat concurrency cap (default 4). Mostly for tests. */
    dirtyFileStatConcurrency?: number;
    /** Override the dirty-file aggregate budget in ms (default 200). Mostly for tests. */
    dirtyFileStatBudgetMs?: number;
    /** Test hook: called immediately before any per-worktree git work begins. */
    onPerWorktreeStart?: (path: string) => void;
    /** Test hook: called after all per-worktree git work for a path finishes. */
    onPerWorktreeFinish?: (path: string) => void;
    /** Test hook: called when a dirty-file stat is dispatched. */
    onDirtyFileStat?: (relativePath: string) => void;
    /** Test hook: called when a dirty-file stat starts (paired with onDirtyFileStatFinish). */
    onDirtyFileStatStart?: (relativePath: string) => void;
    /** Test hook: called when a dirty-file stat finishes (paired with onDirtyFileStatStart). */
    onDirtyFileStatFinish?: (relativePath: string) => void;
}>;

export async function enrichGitWorktreesWithStatus(
    input: EnrichGitWorktreesWithStatusInput,
): Promise<ScmWorktree[]> {
    const worktrees = [...input.worktrees];
    if (input.includeWorktreeStatus !== true) {
        return worktrees;
    }

    const concurrency = Math.max(1, Math.floor(input.concurrency ?? DEFAULT_WORKTREE_STATUS_CONCURRENCY));
    const timeoutMs = Math.max(1, Math.floor(input.perCallTimeoutMs ?? DEFAULT_WORKTREE_STATUS_PER_CALL_TIMEOUT_MS));
    const dirtyOpts = resolveDirtyFileScanOptions(input);
    const enriched: ScmWorktree[] = new Array(worktrees.length);

    let nextIndex = 0;
    const workers: Promise<void>[] = [];
    const workerCount = Math.min(concurrency, worktrees.length);
    for (let workerId = 0; workerId < workerCount; workerId += 1) {
        workers.push((async () => {
            while (true) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= worktrees.length) return;
                const original = worktrees[index]!;

                input.onPerWorktreeStart?.(original.path);
                try {
                    const metrics = await readWorktreeEnrichmentMetrics(original.path, timeoutMs, dirtyOpts);
                    const next: ScmWorktree = { ...original };
                    if (metrics.changeCount !== undefined) next.changeCount = metrics.changeCount;
                    if (metrics.lastActivityAt !== undefined) next.lastActivityAt = metrics.lastActivityAt;
                    enriched[index] = next;
                } finally {
                    input.onPerWorktreeFinish?.(original.path);
                }
            }
        })());
    }

    await Promise.all(workers);
    // Defensive: if for any reason a slot is still empty (e.g. concurrency was 0),
    // fall back to the original to avoid sparse arrays.
    for (let i = 0; i < worktrees.length; i += 1) {
        if (!enriched[i]) enriched[i] = worktrees[i]!;
    }
    return enriched;
}

export type ReadWorktreeStatusEnrichmentForPathsInput = Readonly<{
    worktreePaths: ReadonlyArray<string>;
    /** Override the concurrency cap (default 8). Mostly for tests. */
    concurrency?: number;
    /** Override the per-git-call timeout (default 1500ms). Mostly for tests. */
    perCallTimeoutMs?: number;
    /** Override the per-worktree dirty-file stat cap (default 16). Mostly for tests. */
    dirtyFileStatMaxEntries?: number;
    /** Override the dirty-file stat concurrency cap (default 4). Mostly for tests. */
    dirtyFileStatConcurrency?: number;
    /** Override the dirty-file aggregate budget in ms (default 200). Mostly for tests. */
    dirtyFileStatBudgetMs?: number;
    /** Test hook: called immediately before any per-worktree git work begins. */
    onPerWorktreeStart?: (path: string) => void;
    /** Test hook: called after all per-worktree git work for a path finishes. */
    onPerWorktreeFinish?: (path: string) => void;
    /** Test hook: called when a dirty-file stat is dispatched. */
    onDirtyFileStat?: (relativePath: string) => void;
    /** Test hook: called when a dirty-file stat starts (paired with onDirtyFileStatFinish). */
    onDirtyFileStatStart?: (relativePath: string) => void;
    /** Test hook: called when a dirty-file stat finishes (paired with onDirtyFileStatStart). */
    onDirtyFileStatFinish?: (relativePath: string) => void;
}>;

/**
 * Path-only variant of {@link enrichGitWorktreesWithStatus}: takes just the
 * known worktree paths (resolved by a prior light snapshot) and returns the
 * per-worktree status fields. Designed for the dedicated
 * `scm.worktrees.enrichment` RPC so the UI can render the worktree picker
 * immediately and progressively augment per-worktree status in the background.
 *
 * Performance contract (same as `enrichGitWorktreesWithStatus`): per-call
 * timeout (default 1500ms), concurrency cap (default 8), graceful per-path
 * `undefined` on failures.
 */
export async function readWorktreeStatusEnrichmentForPaths(
    input: ReadWorktreeStatusEnrichmentForPathsInput,
): Promise<ScmWorktreeEnrichmentEntry[]> {
    const paths = [...input.worktreePaths];
    const result: ScmWorktreeEnrichmentEntry[] = new Array(paths.length);

    if (paths.length === 0) {
        return result;
    }

    const concurrency = Math.max(1, Math.floor(input.concurrency ?? DEFAULT_WORKTREE_STATUS_CONCURRENCY));
    const timeoutMs = Math.max(1, Math.floor(input.perCallTimeoutMs ?? DEFAULT_WORKTREE_STATUS_PER_CALL_TIMEOUT_MS));
    const dirtyOpts = resolveDirtyFileScanOptions(input);

    let nextIndex = 0;
    const workers: Promise<void>[] = [];
    const workerCount = Math.min(concurrency, paths.length);
    for (let workerId = 0; workerId < workerCount; workerId += 1) {
        workers.push((async () => {
            while (true) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= paths.length) return;
                const path = paths[index]!;

                input.onPerWorktreeStart?.(path);
                try {
                    const metrics = await readWorktreeEnrichmentMetrics(path, timeoutMs, dirtyOpts);
                    const entry: ScmWorktreeEnrichmentEntry = { path };
                    if (metrics.changeCount !== undefined) entry.changeCount = metrics.changeCount;
                    if (metrics.lastActivityAt !== undefined) entry.lastActivityAt = metrics.lastActivityAt;
                    result[index] = entry;
                } finally {
                    input.onPerWorktreeFinish?.(path);
                }
            }
        })());
    }

    await Promise.all(workers);
    // Defensive: ensure every slot is filled even if a worker dropped one.
    for (let i = 0; i < paths.length; i += 1) {
        if (!result[i]) result[i] = { path: paths[i]! };
    }
    return result;
}

type WorktreeEnrichmentMetrics = Readonly<{
    changeCount: number | undefined;
    lastActivityAt: number | undefined;
}>;

type DirtyFileScanOptions = Readonly<{
    maxEntries: number;
    concurrency: number;
    budgetMs: number;
    onDirtyFileStat?: (relativePath: string) => void;
    onDirtyFileStatStart?: (relativePath: string) => void;
    onDirtyFileStatFinish?: (relativePath: string) => void;
}>;

function resolveDirtyFileScanOptions(input: Readonly<{
    dirtyFileStatMaxEntries?: number;
    dirtyFileStatConcurrency?: number;
    dirtyFileStatBudgetMs?: number;
    onDirtyFileStat?: (relativePath: string) => void;
    onDirtyFileStatStart?: (relativePath: string) => void;
    onDirtyFileStatFinish?: (relativePath: string) => void;
}>): DirtyFileScanOptions {
    return {
        maxEntries: Math.max(0, Math.floor(input.dirtyFileStatMaxEntries ?? DEFAULT_DIRTY_FILE_STAT_MAX_ENTRIES)),
        concurrency: Math.max(1, Math.floor(input.dirtyFileStatConcurrency ?? DEFAULT_DIRTY_FILE_STAT_CONCURRENCY)),
        budgetMs: Math.max(0, Math.floor(input.dirtyFileStatBudgetMs ?? DEFAULT_DIRTY_FILE_STAT_BUDGET_MS)),
        onDirtyFileStat: input.onDirtyFileStat,
        onDirtyFileStatStart: input.onDirtyFileStatStart,
        onDirtyFileStatFinish: input.onDirtyFileStatFinish,
    };
}

/**
 * Compute both `changeCount` and `lastActivityAt` for a single worktree using
 * AT MOST ONE `git status --porcelain -z` invocation.
 *
 * FR3-13 (audit 2026-05-12): the previous implementation called two independent
 * helpers (`readWorktreeChangeCount` and `readWorktreeLastActivityAt`) in
 * parallel, and each ran its own porcelain read — doubling the most expensive
 * per-worktree git call. This function reads porcelain once, parses it once,
 * and derives both metrics from the same parsed entries.
 *
 * It still runs `git log -1 --format=%ct` in parallel with the porcelain read
 * because the two commands are independent and combined latency dominates.
 */
async function readWorktreeEnrichmentMetrics(
    worktreePath: string,
    timeoutMs: number,
    dirtyOpts: DirtyFileScanOptions,
): Promise<WorktreeEnrichmentMetrics> {
    const [headTime, porcelainEntries] = await Promise.all([
        readHeadCommitTimeMs(worktreePath, timeoutMs),
        readWorktreePorcelainEntries(worktreePath, timeoutMs),
    ]);

    const changeCount = porcelainEntries === undefined ? undefined : porcelainEntries.length;

    let baseMs: number | undefined;
    if (headTime.kind === 'value') {
        baseMs = headTime.value;
    } else if (headTime.kind === 'timeout') {
        // Hard timeout on git: respect the response-latency budget and skip the stat fallback.
        return { changeCount, lastActivityAt: undefined };
    } else {
        // headTime.kind === 'failed' — repo without commits, missing path, etc. Fall back to stat.
        try {
            const info = await stat(worktreePath);
            const mtimeMs = Math.floor(info.mtimeMs);
            if (Number.isFinite(mtimeMs) && mtimeMs >= 0) baseMs = mtimeMs;
        } catch {
            // ignore — baseMs remains undefined
        }
    }

    // Walk tracked dirty files (modified/added/deleted/renamed/copied/conflicted, excluding pure
    // untracked '?' entries) and bump baseMs to the newest mtime. Untracked-only churn is
    // intentionally NOT used to advance lastActivityAt because it does not represent committed
    // history activity.
    //
    // FR4-6: the walk is bounded by three independent guardrails so a worktree with many
    // dirty files cannot make enrichment latency proportional to the dirty count:
    //   - `maxEntries` — process at most N tracked-dirty entries even if more exist.
    //   - `concurrency` — overlap stat() latency with a tiny worker pool.
    //   - `budgetMs` — wall-clock budget; once exceeded, stop dispatching and return what's
    //     been accumulated. `changeCount` (from porcelain) is unaffected by this abort.
    if (porcelainEntries && dirtyOpts.maxEntries > 0) {
        const trackedDirty = porcelainEntries.filter((e) => !e.isUntracked).slice(0, dirtyOpts.maxEntries);
        if (trackedDirty.length > 0) {
            const startedAtMs = Date.now();
            let workingTreeMaxMs: number | undefined;
            let nextEntryIndex = 0;
            const isBudgetExceeded = (): boolean => {
                // A budget of 0 means "do not dispatch any stat at all" — useful as a
                // synthetic kill-switch and as a worst-case fallback. The pool then exits
                // immediately, the porcelain-derived `changeCount` is still returned, and
                // `lastActivityAt` falls back to the HEAD time computed earlier.
                if (dirtyOpts.budgetMs === 0) return true;
                return (Date.now() - startedAtMs) > dirtyOpts.budgetMs;
            };
            const dispatchNext = async (): Promise<void> => {
                while (true) {
                    if (isBudgetExceeded()) return;
                    const index = nextEntryIndex;
                    nextEntryIndex += 1;
                    if (index >= trackedDirty.length) return;
                    const entry = trackedDirty[index]!;
                    dirtyOpts.onDirtyFileStat?.(entry.path);
                    dirtyOpts.onDirtyFileStatStart?.(entry.path);
                    try {
                        const info = await stat(join(worktreePath, entry.path));
                        const mtimeMs = Math.floor(info.mtimeMs);
                        if (Number.isFinite(mtimeMs) && mtimeMs >= 0) {
                            if (workingTreeMaxMs === undefined || mtimeMs > workingTreeMaxMs) {
                                workingTreeMaxMs = mtimeMs;
                            }
                        }
                    } catch {
                        // file missing/unreadable — ignore for this worktree
                    } finally {
                        dirtyOpts.onDirtyFileStatFinish?.(entry.path);
                    }
                }
            };
            const workerCount = Math.min(dirtyOpts.concurrency, trackedDirty.length);
            const workers: Promise<void>[] = [];
            for (let w = 0; w < workerCount; w += 1) workers.push(dispatchNext());
            await Promise.all(workers);
            if (workingTreeMaxMs !== undefined) {
                baseMs = baseMs === undefined ? workingTreeMaxMs : Math.max(baseMs, workingTreeMaxMs);
            }
        }
    }

    return { changeCount, lastActivityAt: baseMs };
}

type HeadCommitTimeResult =
    | { kind: 'value'; value: number }
    | { kind: 'failed' }
    | { kind: 'timeout' };

async function readHeadCommitTimeMs(worktreePath: string, timeoutMs: number): Promise<HeadCommitTimeResult> {
    try {
        const result = await runScmCommand({
            bin: 'git',
            cwd: worktreePath,
            args: ['log', '-1', '--format=%ct'],
            timeoutMs,
        });
        if (result.timedOut) return { kind: 'timeout' };
        if (!result.success || result.exitCode !== 0) return { kind: 'failed' };
        const trimmed = (result.stdout ?? '').trim();
        if (!trimmed) return { kind: 'failed' };
        const seconds = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(seconds) || seconds < 0) return { kind: 'failed' };
        return { kind: 'value', value: seconds * 1000 };
    } catch {
        return { kind: 'failed' };
    }
}

type ParsedPorcelainEntry = Readonly<{
    path: string;
    isUntracked: boolean;
}>;

async function readWorktreePorcelainEntries(
    worktreePath: string,
    timeoutMs: number,
): Promise<readonly ParsedPorcelainEntry[] | undefined> {
    try {
        const result = await runScmCommand({
            bin: 'git',
            cwd: worktreePath,
            args: ['status', '--porcelain', '-z'],
            timeoutMs,
        });
        if (!result.success || result.exitCode !== 0) return undefined;
        return parsePorcelainZEntries(result.stdout ?? '');
    } catch {
        return undefined;
    }
}

/**
 * Parse `git status --porcelain -z` output.
 *
 * Format: each entry is `XY <space> path<NUL>`. Renames/copies (`R`/`C`) consume an
 * extra NUL-terminated origin path token: `XY <space> newPath<NUL>oldPath<NUL>`.
 * The two tokens describe ONE logical change and yield exactly one parsed entry.
 *
 * Untracked entries use `XY === '??'` and are flagged via `isUntracked: true` so
 * downstream logic can exclude them from `lastActivityAt` while still counting them
 * in `changeCount`.
 */
function parsePorcelainZEntries(stdout: string): readonly ParsedPorcelainEntry[] {
    if (!stdout) return [];
    // Split on NUL; the trailing NUL produces an empty final segment we discard.
    const tokens = stdout.split('\0');
    const entries: ParsedPorcelainEntry[] = [];
    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];
        if (token === undefined || token.length === 0) {
            i += 1;
            continue;
        }
        // Each header token is `XY <space> path` where XY is two status chars.
        if (token.length < 4) {
            // Malformed; skip to avoid infinite loop.
            i += 1;
            continue;
        }
        const xy = token.slice(0, 2);
        // status header is followed by a single space and then the path; per the
        // porcelain v1 format, byte index 2 is the separator space.
        const path = token.slice(3);
        // Renames/copies emit R/C in the X (index) position only under porcelain
        // v1; the Y (worktree) position is always blank for these. R16d removed
        // the Y-position checks that previously appeared here as dead code.
        const isRenameOrCopy = xy[0] === 'R' || xy[0] === 'C';
        const isUntracked = xy === '??';
        entries.push({ path, isUntracked });
        if (isRenameOrCopy) {
            // Consume the origin path token that follows.
            i += 2;
        } else {
            i += 1;
        }
    }
    return entries;
}
