import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectSessionsCandidatesListResponse } from '@happier-dev/protocol';
import { renderHook } from '@/dev/testkit';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import { useDirectBrowseCandidates } from './useDirectBrowseCandidates';
import { readPhoneCandidateLifecycle } from './phoneBrowseAggregation';

const list = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<DirectSessionsCandidatesListResponse>>());
vi.mock('@/sync/ops/machineDirectSessions', () => ({ machineDirectSessionsCandidatesList: list }));
vi.mock('@/text', () => createTextModuleMock());

const scope = { machineId: 'machine', serverId: 'server', accountId: 'account', providerId: 'codex', source: { kind: 'codexHome', home: 'user' } } as const;
/** 仅模拟 LIST 边界的有限分页，真实 hook 负责合并、代次和调度。 */
function page(ids: string[], nextCursor: string | null = null): DirectSessionsCandidatesListResponse {
    return { ok: true, candidates: ids.map((remoteSessionId, i) => ({ remoteSessionId, updatedAtMs: 100 - i })), nextCursor };
}
/** 创建可控慢响应，以观察请求期间的真实竞态。 */
function deferred() {
    let resolve!: (value: DirectSessionsCandidatesListResponse) => void;
    const promise = new Promise<DirectSessionsCandidatesListResponse>((done) => { resolve = done; });
    return { resolve, promise };
}

/** 电脑端真实协议事实与手机本地时钟分别赋值，避免测试天然同钟。 */
function lifecyclePage(id: string, checkedAtMs: number, nextCursor: string | null = null): DirectSessionsCandidatesListResponse {
    return { ok: true, nextCursor, candidates: [{ remoteSessionId: id, updatedAtMs: checkedAtMs - 1000,
        details: { codexLifecycle: { v: 1, state: 'running', eventAtMs: checkedAtMs - 1000, checkedAtMs } } }] };
}

describe('direct browse discovery window', () => {
    beforeEach(() => { list.mockReset(); list.mockResolvedValue(page(['initial'])); });
    afterEach(() => vi.useRealTimers());

    it('starts only one new query when resume and a search change commit together', async () => {
        let activation = 0;
        const hook = await renderHook((props: { searchTerm: string; observationScope: { isCurrent: () => boolean } }) => useDirectBrowseCandidates({
            ...scope, autoRefreshEnabled: true, ...props,
        }), { initialProps: { searchTerm: '', observationScope: { isCurrent: () => activation === 0 } } });
        activation = 1;
        await hook.rerender({ searchTerm: 'new-query', observationScope: { isCurrent: () => activation === 1 } });
        expect(list).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().loading).toBe(false);
    });

    it.each(['before-commit', 'after-resume'] as const)('invalidates pre-sleep observations and rejects an old flight arriving %s while retaining the loaded window', async (arrival) => {
        vi.useFakeTimers();
        const phoneNow = 1_800_000_000_000;
        vi.setSystemTime(phoneNow);
        let activation = 0;
        const foreground = { isCurrent: () => activation === 0 };
        list.mockResolvedValueOnce(lifecyclePage('first', phoneNow, 'second')).mockResolvedValueOnce(lifecyclePage('deep', phoneNow, 'third'));
        const hook = await renderHook((props: { enabled: boolean; observationScope: { isCurrent: () => boolean } }) => useDirectBrowseCandidates({
            ...scope, autoRefreshEnabled: props.enabled, observationScope: props.observationScope,
        }), { initialProps: { enabled: true, observationScope: foreground } });
        await act(async () => { await hook.getCurrent().loadMore(); });
        const oldFlight = deferred();
        list.mockReturnValueOnce(oldFlight.promise);
        await act(async () => { void hook.getCurrent().refresh(); });
        activation = 1;
        // 原生边界已发生但 React 还未提交，也不能继续把旧缓存作为已知事实展示。
        expect(hook.getCurrent().candidates.map((row) => readPhoneCandidateLifecycle(row, true, Date.now()).state)).toEqual(['unknown', 'unknown']);
        if (arrival === 'before-commit') {
            await act(async () => { oldFlight.resolve(lifecyclePage('resurrected', phoneNow)); });
            expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['first', 'deep']);
        }
        await hook.rerender({ enabled: false, observationScope: { isCurrent: () => false } });
        expect(hook.getCurrent().nextCursor).toBe('third');
        expect(hook.getCurrent().candidates.map((row) => readPhoneCandidateLifecycle(row, true, Date.now()).state)).toEqual(['unknown', 'unknown']);
        const monotonicAtSleep = performance.now();
        vi.setSystemTime(phoneNow + 1_200_000);
        expect(performance.now()).toBe(monotonicAtSleep);
        activation = 2;
        list.mockResolvedValueOnce(lifecyclePage('first', Date.now(), 'second'));
        await hook.rerender({ enabled: true, observationScope: { isCurrent: () => activation === 2 } });
        if (arrival === 'after-resume') await act(async () => { oldFlight.resolve(lifecyclePage('resurrected', phoneNow)); });
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['first', 'deep']);
        expect(hook.getCurrent().candidates.map((row) => readPhoneCandidateLifecycle(row, true, Date.now()).state)).toEqual(['running', 'unknown']);
        expect(hook.getCurrent().nextCursor).toBe('third');
        expect(list).toHaveBeenCalledTimes(4);
    });

    it('never revives an expired retained page when the phone wall clock rolls back but stays after receipt', async () => {
        vi.useFakeTimers();
        const phoneNow = 1_800_000_000_000;
        vi.setSystemTime(phoneNow);
        list.mockResolvedValueOnce(lifecyclePage('cached', phoneNow + 34_900));
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        const candidate = hook.getCurrent().candidates[0]!;
        const monotonicStart = performance.now();
        await act(async () => { await vi.advanceTimersByTimeAsync(900_001); });
        expect(performance.now() - monotonicStart).toBe(900_001);
        expect(readPhoneCandidateLifecycle(candidate, true, Date.now()).state).toBe('unknown');
        vi.setSystemTime(phoneNow + 870_001);
        expect(readPhoneCandidateLifecycle(candidate, true, Date.now()).state).toBe('unknown');
        expect(list).toHaveBeenCalledTimes(1);
    });

    it('ages retained deep pages and failed windows from their own LIST request instead of the latest refresh', async () => {
        vi.useFakeTimers();
        const phoneNow = 1_800_000_000_000;
        vi.setSystemTime(phoneNow);
        list.mockResolvedValueOnce(lifecyclePage('first', phoneNow + 34_900, 'second')).mockResolvedValueOnce(lifecyclePage('deep', phoneNow + 34_900));
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        await act(async () => { await hook.getCurrent().loadMore(); });
        const deep = hook.getCurrent().candidates.find((candidate) => candidate.remoteSessionId === 'deep')!;
        expect(readPhoneCandidateLifecycle(deep, true, phoneNow).state).toBe('running');
        await act(async () => { await vi.advanceTimersByTimeAsync(900_001); });
        list.mockResolvedValueOnce(lifecyclePage('first', Date.now() + 34_900, 'second'));
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(readPhoneCandidateLifecycle(hook.getCurrent().candidates[0]!, true, Date.now()).state).toBe('running');
        expect(hook.getCurrent().candidates[1]).toBe(deep);
        expect(readPhoneCandidateLifecycle(deep, true, Date.now()).state).toBe('unknown');
        const retained = hook.getCurrent().candidates;
        list.mockResolvedValueOnce({ ok: false, errorCode: 'internal_error', error: 'offline' });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().candidates).toBe(retained);
        await act(async () => { await vi.advanceTimersByTimeAsync(900_001); });
        expect(readPhoneCandidateLifecycle(retained[0]!, true, Date.now()).state).toBe('unknown');
    });

    it('includes request latency in freshness and never attaches a new age to an inherited lifecycle', async () => {
        vi.useFakeTimers();
        const phoneNow = 1_800_000_000_000;
        vi.setSystemTime(phoneNow);
        const delayed = deferred();
        list.mockReturnValueOnce(delayed.promise);
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        await act(async () => { await vi.advanceTimersByTimeAsync(900_001); });
        await act(async () => { delayed.resolve(lifecyclePage('same', phoneNow + 34_900, 'second')); });
        expect(readPhoneCandidateLifecycle(hook.getCurrent().candidates[0]!, true, Date.now()).state).toBe('unknown');
        list.mockResolvedValueOnce(page(['same']));
        await act(async () => { await hook.getCurrent().loadMore(); });
        expect(readPhoneCandidateLifecycle(hook.getCurrent().candidates[0]!, true, Date.now()).state).toBe('unknown');
        expect(hook.getCurrent().candidates[0]?.details?.codexLifecycle).toBeUndefined();
    });

    it.each([0, -10_000])('keeps the new first-page fact over an overlapping retained page with local clock change %i', async (clockChange) => {
        vi.useFakeTimers();
        const phoneNow = 1_800_000_000_000;
        vi.setSystemTime(phoneNow);
        list.mockResolvedValueOnce(lifecyclePage('first', phoneNow, 'second'));
        list.mockResolvedValueOnce({ ok: true, nextCursor: null, candidates: [{ remoteSessionId: 'overlap', updatedAtMs: phoneNow - 1000,
            details: { codexLifecycle: { v: 1, state: 'completed', eventAtMs: phoneNow - 1000, checkedAtMs: phoneNow } } }] });
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        await act(async () => { await hook.getCurrent().loadMore(); });
        vi.setSystemTime(phoneNow + clockChange);
        list.mockResolvedValueOnce(lifecyclePage('overlap', phoneNow + 1000, 'second'));
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().candidates).toHaveLength(1);
        expect(readPhoneCandidateLifecycle(hook.getCurrent().candidates[0]!, true, Date.now()).state).toBe('running');
    });

    it('keeps fresh facts when only wall time moves backwards during a request or while cached', async () => {
        vi.useFakeTimers();
        const phoneNow = 1_800_000_000_000;
        vi.setSystemTime(phoneNow);
        const delayed = deferred();
        list.mockReturnValueOnce(delayed.promise);
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        vi.setSystemTime(phoneNow - 1000);
        await act(async () => { delayed.resolve(lifecyclePage('backwards', phoneNow)); });
        expect(readPhoneCandidateLifecycle(hook.getCurrent().candidates[0]!, true, Date.now()).state).toBe('running');
        list.mockResolvedValueOnce(lifecyclePage('fresh', phoneNow));
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(readPhoneCandidateLifecycle(hook.getCurrent().candidates[0]!, true, Date.now()).state).toBe('running');
        vi.setSystemTime(phoneNow - 2000);
        expect(readPhoneCandidateLifecycle(hook.getCurrent().candidates[0]!, true, Date.now()).state).toBe('running');
    });

    it('keeps deeper pages when the first opaque cursor is unchanged and replaces missing first-page rows', async () => {
        list.mockResolvedValueOnce(page(['old'], 'second')).mockResolvedValueOnce(page(['deep'], 'third'));
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        await act(async () => { await hook.getCurrent().loadMore(); });
        list.mockResolvedValueOnce(page(['new'], 'second'));
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['new', 'deep']);
        expect(hook.getCurrent().nextCursor).toBe('third');
        expect(list).toHaveBeenCalledTimes(3);
    });

    it('atomically rebuilds only the loaded page count when the cursor moves, evicting disappeared rows', async () => {
        list.mockResolvedValueOnce(page(['old'], 'second')).mockResolvedValueOnce(page(['deleted'], 'third'));
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        await act(async () => { await hook.getCurrent().loadMore(); });
        const deep = deferred();
        list.mockResolvedValueOnce(page(['new'], 'moved')).mockReturnValueOnce(deep.promise);
        let refresh!: Promise<void>;
        await act(async () => { refresh = hook.getCurrent().refresh(); });
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['old', 'deleted']);
        await act(async () => { deep.resolve(page(['retained'], 'unread')); await refresh; });
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['new', 'retained']);
        expect(hook.getCurrent().nextCursor).toBe('unread');
        expect(list).toHaveBeenCalledTimes(4);
    });

    it.each(['error', 'invalid', 'cycle'] as const)('preserves the entire old window after rebuild %s', async (failure) => {
        list.mockResolvedValueOnce(page(['old'], 'second')).mockResolvedValueOnce(page(['deep'], 'third'));
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        await act(async () => { await hook.getCurrent().loadMore(); });
        list.mockResolvedValueOnce(page(['new'], 'moved')).mockResolvedValueOnce(failure === 'cycle' ? page(['bad'], 'moved') : {
            ok: false, errorCode: 'internal_error', error: 'unavailable', ...(failure === 'invalid' ? { refreshRequired: true } : {}),
        });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['old', 'deep']);
        expect(hook.getCurrent().nextCursor).toBe('third');
        expect(Boolean(hook.getCurrent().error) || hook.getCurrent().refreshRequired).toBe(true);
    });

    it('coalesces repeated refresh and paging during a slow request without starving its result', async () => {
        list.mockResolvedValueOnce(page(['old'], 'second'));
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        const pending = deferred();
        list.mockReturnValueOnce(pending.promise);
        let first!: Promise<void>;
        await act(async () => { first = hook.getCurrent().refresh(); void hook.getCurrent().refresh(); void hook.getCurrent().loadMore(); });
        expect(list).toHaveBeenCalledTimes(2);
        await act(async () => { pending.resolve(page(['latest'])); await first; });
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['latest']);
    });

    it('invalidates a pending response after successful deletion without reviving the row', async () => {
        const hook = await renderHook(() => useDirectBrowseCandidates(scope));
        const pending = deferred();
        list.mockReturnValueOnce(pending.promise);
        let refresh!: Promise<void>;
        await act(async () => { refresh = hook.getCurrent().refresh(); hook.getCurrent().removeCandidate('initial'); });
        await act(async () => { pending.resolve(page(['initial'])); await refresh; });
        expect(hook.getCurrent().candidates).toEqual([]);
        expect(hook.getCurrent().loading).toBe(false);
    });

    it('rejects old-account responses even when server, machine and source stay the same', async () => {
        const old = deferred();
        list.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(['new-account']));
        const hook = await renderHook((accountId: string) => useDirectBrowseCandidates({ ...scope, accountId }), { initialProps: 'old' });
        await hook.rerender('new');
        await act(async () => { old.resolve(page(['private-old'])); });
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['new-account']);
    });

    it('starts only when eligible, coalesces activation while slow, and waits a full interval after completion', async () => {
        vi.useFakeTimers();
        const pending = deferred();
        list.mockReturnValueOnce(pending.promise);
        const hook = await renderHook((enabled: boolean) => useDirectBrowseCandidates({ ...scope, autoRefreshEnabled: enabled }), { initialProps: false });
        expect(list).not.toHaveBeenCalled();
        await hook.rerender(true);
        await hook.rerender(false);
        await hook.rerender(true);
        await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
        expect(list).toHaveBeenCalledTimes(1);
        await act(async () => { pending.resolve(page(['slow'])); });
        await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
        expect(list).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(list).toHaveBeenCalledTimes(2);
        await hook.rerender(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
        expect(list).toHaveBeenCalledTimes(2);
    });

    it('does not repeatedly scan history while searching', async () => {
        vi.useFakeTimers();
        list.mockResolvedValueOnce({ ...page(['fast']), searchIncomplete: true }).mockResolvedValueOnce(page(['full']));
        const hook = await renderHook(() => useDirectBrowseCandidates({ ...scope, searchTerm: 'query', autoRefreshEnabled: true }));
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['fast', 'full']);
        await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
        expect(list).toHaveBeenCalledTimes(2);
    });

    it('keeps full-search history and its cursor when returning only yields an incomplete fast search', async () => {
        list.mockResolvedValueOnce({ ...page([], 'fast-page'), searchIncomplete: true }).mockResolvedValueOnce(page(['historical-match'], 'full-page'));
        const hook = await renderHook((enabled: boolean) => useDirectBrowseCandidates({ ...scope, searchTerm: 'history', autoRefreshEnabled: enabled }), { initialProps: true });
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['historical-match']);
        await hook.rerender(false);
        list.mockResolvedValueOnce({ ...page([], 'fast-page'), searchIncomplete: true });
        await hook.rerender(true);
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['historical-match']);
        expect(hook.getCurrent().nextCursor).toBe('full-page');
        expect(hook.getCurrent().searchIncomplete).toBe(true);
        expect(list).toHaveBeenCalledTimes(3);
    });

    it('pauses during an action including the synchronous gap before its state commits, then resumes after completion', async () => {
        vi.useFakeTimers();
        let actionPending = false;
        const hook = await renderHook((busy: boolean) => useDirectBrowseCandidates({
            ...scope, autoRefreshEnabled: true, actionPending: busy, isActionPending: () => actionPending,
        }), { initialProps: false });
        actionPending = true;
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
        expect(list).toHaveBeenCalledTimes(1);
        await hook.rerender(true);
        await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
        expect(list).toHaveBeenCalledTimes(1);
        actionPending = false;
        await hook.rerender(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
        expect(list).toHaveBeenCalledTimes(2);
    });

    it('loads a search selected during an action once that action releases, without waiting for another focus event', async () => {
        const hook = await renderHook((busy: boolean) => useDirectBrowseCandidates({
            ...scope, searchTerm: 'query', autoRefreshEnabled: true, actionPending: busy,
        }), { initialProps: true });
        expect(list).not.toHaveBeenCalled();
        await hook.rerender(false);
        expect(hook.getCurrent().candidates.map((row) => row.remoteSessionId)).toEqual(['initial']);
        expect(list).toHaveBeenCalledTimes(1);
    });
});
