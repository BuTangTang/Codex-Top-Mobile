import { describe, expect, it, vi } from 'vitest';
import { aggregatePhoneBrowseSources, readPhoneCandidateLifecycle, type PhoneBrowseSource, type PhoneBrowseSnapshot } from './phoneBrowseAggregation';

const nowMs = 1_800_000_000_000;
const source = { kind: 'codexHome', home: 'user' } as const;

/** 只生成来源身份与受控快照，不模拟被测的聚合或状态分派。 */
function fixture(machineId: string, remoteSessionId: string, state = 'running', eventAtMs = nowMs - 1000) {
    const descriptor: PhoneBrowseSource = { key: machineId, machineId, machineLabel: machineId, sourceKey: 'codex:user', source, online: true };
    const snapshot: PhoneBrowseSnapshot = {
        candidates: [{ remoteSessionId, updatedAtMs: eventAtMs, activity: 'running', details: { codexLifecycle: { v: 1, state, eventAtMs, checkedAtMs: nowMs } } }],
        loading: false, loadingMore: false, searchAugmenting: false, searchIncomplete: false,
        refreshRequired: false, error: null, nextCursor: null, linkingSessionId: null,
        refresh: vi.fn(async () => {}), loadMore: vi.fn(async () => {}), selectCandidate: vi.fn(async () => {}),
    };
    return { descriptor, snapshot };
}

describe('phone browse aggregation', () => {
    it('merges sources into a globally sorted list without conflating identical remote ids on different computers', () => {
        const first = fixture('a', 'same-id', 'running', nowMs - 3000);
        const second = fixture('b', 'same-id', 'running', nowMs - 1000);
        const result = aggregatePhoneBrowseSources({ serverId: 's', accountId: 'a', sources: [first.descriptor, second.descriptor], snapshots: { a: first.snapshot, b: second.snapshot }, phase: 'running', nowMs });
        expect(result.rows.map((row) => row.ownerKey)).toEqual(['b', 'a']);
        expect(new Set(result.rows.map((row) => row.key)).size).toBe(2);
        expect(result.rows[0]?.snapshot).toBe(second.snapshot);
        expect(aggregatePhoneBrowseSources({ serverId: 'other', accountId: 'a', sources: [second.descriptor], snapshots: { b: second.snapshot }, phase: 'running', nowMs }).rows[0]?.key).not.toBe(result.rows[0]?.key);
    });

    it('uses explicit lifecycle facts only and lets unknown, failed and cancelled stay accessible in full history', () => {
        const f = fixture('a', 'r');
        for (const candidate of [
            { ...f.snapshot.candidates[0]!, details: {} },
            { ...f.snapshot.candidates[0]!, details: { codexLifecycle: { v: 2, state: 'completed' } } },
            fixture('a', 'r', 'running', nowMs - 900_001).snapshot.candidates[0]!,
        ]) expect(readPhoneCandidateLifecycle(candidate, true, nowMs).state).toBe('unknown');
        expect(readPhoneCandidateLifecycle(f.snapshot.candidates[0]!, false, nowMs).state).toBe('unknown');
        expect(readPhoneCandidateLifecycle(f.snapshot.candidates[0]!, true, nowMs + 900_001).state).toBe('unknown');
        for (const state of ['failed', 'cancelled', 'unknown']) {
            const exceptional = fixture('a', state, state);
            const args = { serverId: 's', accountId: 'a', sources: [exceptional.descriptor], snapshots: { a: exceptional.snapshot }, nowMs };
            expect(aggregatePhoneBrowseSources({ ...args, phase: 'completed' }).rows).toHaveLength(0);
            expect(aggregatePhoneBrowseSources({ ...args, phase: 'completed' }).hasUnclassified).toBe(true);
            expect(aggregatePhoneBrowseSources({ ...args, phase: null }).rows[0]?.lifecycle.state).toBe(state);
        }
    });

    it('keeps partial loading and pagination recoverable when the visible phase has no rows', () => {
        const f = fixture('a', 'done', 'completed');
        const result = aggregatePhoneBrowseSources({ serverId: 's', accountId: 'a', sources: [f.descriptor, { ...f.descriptor, key: 'slow', machineId: 'slow' }], snapshots: { a: { ...f.snapshot, nextCursor: 'cursor' } }, phase: 'running', nowMs });
        expect(result.rows).toHaveLength(0);
        expect(result.loading).toBe(true);
        expect(result.hasMore).toBe(true);
        expect(result.loadMoreSources).toHaveLength(1);
    });

    it('does not broaden an invalid project or leak candidates from a sibling directory or source', () => {
        const f = fixture('a', 'r');
        const args = { serverId: 's', accountId: 'a', sources: [f.descriptor], snapshots: { a: { ...f.snapshot, candidates: [{ ...f.snapshot.candidates[0]!, details: { ...f.snapshot.candidates[0]!.details, cwd: '/work/project-sibling' } }] } }, phase: null, nowMs };
        expect(aggregatePhoneBrowseSources({ ...args, project: { sourceKey: 'codex:user', name: '真实项目', rootPaths: ['/work/project'], available: true } }).rows).toHaveLength(0);
        expect(aggregatePhoneBrowseSources({ ...args, project: null, projectRequired: true }).rows).toHaveLength(0);
    });
});
