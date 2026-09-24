import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregatePhoneBrowseSources, readPhoneCandidateLifecycle, type PhoneBrowseSource, type PhoneBrowseSnapshot } from './phoneBrowseAggregation';

const nowMs = 1_800_000_000_000;
const source = { kind: 'codexHome', home: 'user' } as const;

/** 只生成来源身份与受控快照，不模拟被测的聚合或状态分派。 */
function fixture(machineId: string, remoteSessionId: string, state = 'running', eventAtMs = nowMs - 1000) {
    const descriptor: PhoneBrowseSource = { key: machineId, machineId, machineLabel: machineId, sourceKey: 'codex:user', source, online: true };
    const snapshot: PhoneBrowseSnapshot = {
        candidates: [{ remoteSessionId, updatedAtMs: eventAtMs, activity: 'running', listObservation: { requestedAtMs: nowMs, receivedAtMs: nowMs, requestedMonotonicMs: 0, receivedMonotonicMs: 0 }, details: { codexLifecycle: { v: 1, state, eventAtMs, checkedAtMs: nowMs } } }],
        loading: false, loadingMore: false, searchAugmenting: false, searchIncomplete: false,
        refreshRequired: false, error: null, nextCursor: null, linkingSessionId: null,
        refresh: vi.fn(async () => {}), loadMore: vi.fn(async () => {}), selectCandidate: vi.fn(async () => {}),
    };
    return { descriptor, snapshot };
}

describe('phone browse aggregation', () => {
    beforeEach(() => { vi.spyOn(performance, 'now').mockReturnValue(0); });
    afterEach(() => vi.restoreAllMocks());
    it.each([34_900, -3_600_000])('keeps valid desktop facts with a %i ms clock offset and expires them in phone time', (offset) => {
        const f = fixture('a', 'running');
        for (const state of ['running', 'completed', 'needs_input']) {
            const candidate = { ...f.snapshot.candidates[0]!, updatedAtMs: nowMs + offset - 1000,
                details: { codexLifecycle: { v: 1, state, eventAtMs: nowMs + offset - 1000, checkedAtMs: nowMs + offset } } };
            expect(readPhoneCandidateLifecycle(candidate, true, nowMs).state).toBe(state);
            expect(readPhoneCandidateLifecycle(candidate, true, nowMs + 900_001, 900_001).state).toBe('unknown');
            expect(readPhoneCandidateLifecycle(candidate, false, nowMs).state).toBe('unknown');
        }
    });

    it('adds local elapsed time to desktop running age, preserving protocol-future and missing-context protections', () => {
        const f = fixture('a', 'running');
        const checkedAtMs = nowMs + 3_600_000;
        const candidate = { ...f.snapshot.candidates[0]!, details: { codexLifecycle: { v: 1, state: 'running', eventAtMs: checkedAtMs - 899_000, checkedAtMs } } };
        expect(readPhoneCandidateLifecycle(candidate, true, nowMs + 500, 500).state).toBe('running');
        expect(readPhoneCandidateLifecycle(candidate, true, nowMs + 1001, 1001).state).toBe('unknown');
        expect(readPhoneCandidateLifecycle({ ...candidate, details: { codexLifecycle: { v: 1, state: 'running', eventAtMs: checkedAtMs + 1, checkedAtMs } } }, true, nowMs).state).toBe('unknown');
        expect(readPhoneCandidateLifecycle({ ...f.snapshot.candidates[0]!, listObservation: undefined }, true, nowMs).state).toBe('unknown');
        expect(readPhoneCandidateLifecycle(candidate, true, nowMs, NaN).state).toBe('unknown');
        expect(readPhoneCandidateLifecycle({ ...candidate, listObservation: { requestedAtMs: nowMs, receivedAtMs: nowMs, requestedMonotonicMs: 1, receivedMonotonicMs: 0 } }, true, nowMs).state).toBe('unknown');
    });

    it('orders different desktop clock domains by update time relative to their own LIST observation', () => {
        const ahead = fixture('a', 'ahead');
        const behind = fixture('b', 'behind');
        const aheadCandidate = { ...ahead.snapshot.candidates[0]!, updatedAtMs: nowMs + 34_900 - 3000,
            details: { codexLifecycle: { v: 1, state: 'completed', eventAtMs: nowMs + 34_900 - 100, checkedAtMs: nowMs + 34_900 } } };
        const behindCandidate = { ...behind.snapshot.candidates[0]!, updatedAtMs: nowMs - 3_600_000 - 1000,
            details: { codexLifecycle: { v: 1, state: 'completed', eventAtMs: nowMs - 3_600_000 - 10, checkedAtMs: nowMs - 3_600_000 } } };
        const rows = aggregatePhoneBrowseSources({ serverId: 's', accountId: 'a', sources: [ahead.descriptor, behind.descriptor],
            snapshots: { a: { ...ahead.snapshot, candidates: [aheadCandidate] }, b: { ...behind.snapshot, candidates: [behindCandidate] } }, phase: 'completed', nowMs }).rows;
        expect(rows.map((row) => row.candidate.remoteSessionId)).toEqual(['behind', 'ahead']);
        expect(rows.map((row) => row.timeMs)).toEqual([nowMs - 1000, nowMs - 3000]);
    });

    it('orders by valid update time independently from lifecycle time, with stable identity ties', () => {
        const f = fixture('a', 'old', 'completed', nowMs - 1);
        const candidates = [
            { ...f.snapshot.candidates[0]!, updatedAtMs: nowMs - 500 },
            { ...f.snapshot.candidates[0]!, remoteSessionId: 'new', updatedAtMs: nowMs - 10, details: {} },
            { ...f.snapshot.candidates[0]!, remoteSessionId: 'future', updatedAtMs: nowMs + 1 },
            { ...f.snapshot.candidates[0]!, remoteSessionId: 'invalid', updatedAtMs: NaN },
        ];
        const args = { serverId: 's', accountId: 'a', sources: [f.descriptor], phase: null, nowMs };
        const rows = aggregatePhoneBrowseSources({ ...args, snapshots: { a: { ...f.snapshot, candidates } } }).rows;
        expect(rows.map((row) => row.candidate.remoteSessionId)).toEqual(['new', 'old', 'future', 'invalid']);
        expect(rows[0]?.lifecycle.state).toBe('unknown');
        expect(aggregatePhoneBrowseSources({ ...args, snapshots: { a: { ...f.snapshot, candidates: [...candidates].reverse() } } }).rows.map((row) => row.key)).toEqual(rows.map((row) => row.key));
    });

    it('deduplicates the complete identity using the updated candidate without mistaking a lifecycle check for recency', () => {
        const f = fixture('a', 'same', 'completed', nowMs - 100);
        const newer = { ...f.snapshot, candidates: [{ ...f.snapshot.candidates[0]!, title: 'Updated title', updatedAtMs: nowMs - 1,
            listObservation: { requestedAtMs: nowMs - 1, receivedAtMs: nowMs - 1, requestedMonotonicMs: 0, receivedMonotonicMs: 0 },
            details: { codexLifecycle: { v: 1, state: 'completed', eventAtMs: nowMs - 1000, checkedAtMs: nowMs - 1 } } }] };
        const result = aggregatePhoneBrowseSources({ serverId: 's', accountId: 'a', sources: [f.descriptor, { ...f.descriptor, key: 'overlap' }],
            snapshots: { a: f.snapshot, overlap: newer }, phase: 'completed', nowMs });
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.candidate.title).toBe('Updated title');
        expect(result.rows[0]?.timeMs).toBe(nowMs - 1);
    });

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
        expect(readPhoneCandidateLifecycle(f.snapshot.candidates[0]!, true, nowMs + 900_001, 900_001).state).toBe('unknown');
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
