import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSqliteDatabaseSync } from '@/utils/sqlite/sqliteSync';
import { readPersistedDesktopGoal } from './desktopGoalStore';
import { createDesktopGoalStoreIdentityExecFileMock } from './desktopGoalStoreIdentity.testFixtures';

// Only OS process responses are replaced; source verification and native SQLite reads stay real.
vi.mock('node:child_process', async (importOriginal) => ({
    ...await importOriginal<typeof import('node:child_process')>(), execFile: vi.fn(),
}));

describe('persisted Desktop goal read', () => {
    let home: string;
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    beforeEach(async () => {
        home = await realpath(await mkdtemp(join(tmpdir(), 'desktop-goal-')));
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        vi.mocked(execFile).mockReset();
        vi.mocked(execFile).mockImplementation(createDesktopGoalStoreIdentityExecFileMock({ resolvedHome: home }));
    });
    afterEach(async () => {
        Object.defineProperty(process, 'platform', originalPlatform);
        await rm(home, { recursive: true, force: true });
    });
    function database() {
        const db = openSqliteDatabaseSync(join(home, 'goals_1.sqlite'));
        // Official rust-v0.160.0 thread_goals projection, independent synthetic data only.
        db.exec('CREATE TABLE thread_goals (thread_id TEXT PRIMARY KEY, objective TEXT, status TEXT, token_budget INTEGER, tokens_used INTEGER, time_used_seconds INTEGER, updated_at_ms INTEGER)');
        return db;
    }
    const read = () => readPersistedDesktopGoal(home, 'target');

    it('reads committed WAL changes and deletion without cached state or database writes', async () => {
        const db = database();
        try {
            db.exec('PRAGMA journal_mode=WAL');
            db.prepare('INSERT INTO thread_goals VALUES (?,?,?,?,?,?,?)').run('target', 'Synthetic objective', 'blocked', null, 20, 40, 1790989070221);
            expect(await read()).toMatchObject({ availability: 'available', threadId: 'target', status: 'blocked', tokenBudget: null, updatedAt: 1790989070 });
            db.prepare('UPDATE thread_goals SET status=?, tokens_used=? WHERE thread_id=?').run('budget_limited', 30, 'target');
            expect(await read()).toMatchObject({ status: 'budgetLimited', tokensUsed: 30 });
            db.prepare('DELETE FROM thread_goals WHERE thread_id=?').run('target');
            expect(await read()).toEqual({ availability: 'none', source: 'desktop' });
        } finally { db.close(); }
    });

    it('keeps older seconds timestamps and usage-limited status compatible', async () => {
        const db = database();
        db.prepare('INSERT INTO thread_goals VALUES (?,?,?,?,?,?,?)').run('target', 'Synthetic', 'usage_limited', 10, 9, 3, 1790919932);
        db.close();
        expect(await read()).toMatchObject({ availability: 'available', status: 'usageLimited', updatedAt: 1790919932 });
    });

    it.each([-1, 1.5, 'invalid', null])('keeps invalid persisted timestamps unknown: %s', async (timestamp) => {
        const db = database();
        db.prepare('INSERT INTO thread_goals VALUES (?,?,?,?,?,?,?)').run('target', 'Synthetic', 'active', null, 0, 0, timestamp);
        db.close();
        expect(await read()).toEqual({ availability: 'unknown' });
    });

    it('does not create a missing database and does not treat unsupported schema as no goal', async () => {
        expect(await read()).toEqual({ availability: 'unknown' });
        expect(await readdir(home)).toEqual([]);
        expect(execFile).not.toHaveBeenCalled();
        const db = openSqliteDatabaseSync(join(home, 'goals_1.sqlite'));
        db.exec('CREATE TABLE other (id TEXT)');
        db.close();
        expect(await read()).toEqual({ availability: 'unknown' });
    });

    it('reads only the requested thread and rejects malformed values', async () => {
        const db = database();
        try {
            db.prepare('INSERT INTO thread_goals VALUES (?,?,?,?,?,?,?)').run('other', 'Other objective', 'active', null, 0, 0, 1790989070221);
            expect(await read()).toEqual({ availability: 'none', source: 'desktop' });
            db.prepare('INSERT INTO thread_goals VALUES (?,?,?,?,?,?,?)').run('target', 'Synthetic', 'active', null, -1, 0, 1790989070221);
            expect(await read()).toEqual({ availability: 'unknown' });
        } finally { db.close(); }
    });

    it('does not query a valid stale database when the live app-server opens another file', async () => {
        const db = database();
        db.prepare('INSERT INTO thread_goals VALUES (?,?,?,?,?,?,?)').run('target', 'Stale synthetic objective', 'active', null, 0, 0, 1790989070221);
        db.close();
        const otherHome = join(home, 'other');
        await mkdir(otherHome);
        const otherPath = join(otherHome, 'goals_1.sqlite');
        const other = openSqliteDatabaseSync(otherPath);
        other.close();
        vi.mocked(execFile).mockImplementation(createDesktopGoalStoreIdentityExecFileMock({ resolvedHome: home, databasePath: otherPath }));
        const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
        const close = vi.spyOn(DatabaseSync.prototype, 'close');
        try {
            expect(await read()).toEqual({ availability: 'unknown' });
            expect(execFile).toHaveBeenCalled();
            expect(prepare).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
        } finally { prepare.mockRestore(); close.mockRestore(); }
    });

    it('does not query SQLite when the external process identity probe fails', async () => {
        const db = database();
        db.close();
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
            callback(new Error('Synthetic OS process probe failed'), '', '');
            return {} as ReturnType<typeof execFile>;
        });
        const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
        const close = vi.spyOn(DatabaseSync.prototype, 'close');
        try {
            expect(await read()).toEqual({ availability: 'unknown' });
            expect(execFile).toHaveBeenCalled();
            expect(prepare).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
        } finally { prepare.mockRestore(); close.mockRestore(); }
    });

    it('rejects a symbolic-link database before probing processes', async () => {
        const db = database();
        db.close();
        const path = join(home, 'goals_1.sqlite');
        const target = join(home, 'other.sqlite');
        await rm(path);
        const other = openSqliteDatabaseSync(target);
        other.close();
        await symlink(target, path);
        expect(await read()).toEqual({ availability: 'unknown' });
        expect(execFile).not.toHaveBeenCalled();
    });

    it('keeps unsupported process identity platforms unknown without invoking macOS probes', async () => {
        const db = database();
        db.close();
        Object.defineProperty(process, 'platform', { value: 'linux' });
        expect(await read()).toEqual({ availability: 'unknown' });
        expect(execFile).not.toHaveBeenCalled();
    });

    it('keeps a native SQLite close failure inside the unknown goal boundary', async () => {
        const db = database();
        db.close();
        const close = DatabaseSync.prototype.close;
        const failure = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
            close.call(this);
            throw new Error('Synthetic native SQLite close failure');
        });
        try { expect(await read()).toEqual({ availability: 'unknown' }); }
        finally { failure.mockRestore(); }
    });

    it('opens read-only handles that reject writes and never create missing files', async () => {
        const db = database();
        db.close();
        const file = join(home, 'goals_1.sqlite');
        const before = await readFile(file);
        const reader = openSqliteDatabaseSync(file, { readOnly: true });
        try { expect(() => reader.exec('INSERT INTO thread_goals (thread_id) VALUES (\'target\')')).toThrow(); }
        finally { reader.close(); }
        expect(await readFile(file)).toEqual(before);
        expect(() => openSqliteDatabaseSync(join(home, 'absent.sqlite'), { readOnly: true })).toThrow();
        expect(await readdir(home)).not.toContain('absent.sqlite');
    });
});
