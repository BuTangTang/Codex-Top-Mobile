import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { openSqliteDatabaseSync, type SqliteDatabaseSync } from '@/utils/sqlite/sqliteSync';
import { readDesktopGoal, type DesktopGoalReadV1 } from './desktopGoal';
import { verifyDesktopGoalStoreIdentity } from './desktopGoalStoreIdentity';

const UNKNOWN: DesktopGoalReadV1 = { availability: 'unknown' };

/**
 * Read the official persisted goal, just as thread/goal/get does, without loading conversation history.
 * The authenticated caller supplies the resolved source home. Read only when the live Desktop process
 * owns this router and its sole local app-server has this exact database open; never guess from configuration.
 * Never infer another account's location, create a database, or mutate Codex state.
 */
export async function readPersistedDesktopGoal(codexHome: string, threadId: string): Promise<DesktopGoalReadV1> {
    let database: SqliteDatabaseSync | undefined;
    try {
        try {
            if (!threadId.trim()) return UNKNOWN;
            const path = join(codexHome, 'goals_1.sqlite');
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink()) return UNKNOWN;
            if (!await verifyDesktopGoalStoreIdentity(codexHome, path)) return UNKNOWN;
            database = openSqliteDatabaseSync(path, { readOnly: true });
            const row = database.prepare(`SELECT thread_id, objective, status, token_budget, tokens_used,
                time_used_seconds, updated_at_ms FROM thread_goals WHERE thread_id = ?`).get(threadId);
            if (row === undefined || row === null) return { availability: 'none', source: 'desktop' };
            if (typeof row !== 'object' || Array.isArray(row)) return UNKNOWN;
            const value = row as Record<string, unknown>;
            const timestamp = value.updated_at_ms;
            if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp < 0) return UNKNOWN;
            // Official rust-v0.160.0 epoch_millis_to_datetime also accepts older seconds values.
            const updatedAt = timestamp < 1_577_836_800_000 ? timestamp : Math.floor(timestamp / 1000);
            const status = value.status === 'usage_limited' ? 'usageLimited'
                : value.status === 'budget_limited' ? 'budgetLimited' : value.status;
            return readDesktopGoal({ id: threadId, threadGoal: {
                threadId: value.thread_id, objective: value.objective, status,
                tokenBudget: value.token_budget, tokensUsed: value.tokens_used,
                timeUsedSeconds: value.time_used_seconds, updatedAt,
            } }, threadId);
        } finally { database?.close(); }
    } catch {
        // Missing/unsupported/locked stores remain visibly unknown, never an inferred empty goal.
        return UNKNOWN;
    }
}
