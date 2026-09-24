import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react-test-renderer';
import { renderHook, createDeferred } from '@/dev/testkit';
const mocks = vi.hoisted(() => ({ read: vi.fn(), action: vi.fn(), accountId: 'account-a', serverId: 'server' }));
vi.mock('@/sync/ops/machineDirectSessions', () => ({ machineDirectSessionControlRead: mocks.read, machineDirectSessionControlAction: mocks.action }));
vi.mock('@/sync/store/hooks', () => ({ useActiveServerAccountScope: () => ({ serverId: mocks.serverId, accountId: mocks.accountId }) }));
vi.mock('@/platform/randomUUID', () => ({ randomUUID: () => 'operation-once' }));
const request = { requestId: 'request', revision: 'rev', kind: 'command' as const, command: 'echo example', canDecide: true };
const snapshot = { v: 1, turnId: 'turn', state: 'running', requests: [request], textSendMode: 'steer' };
const input = { sessionId: 'linked', machineId: 'machine', serverId: 'server', enabled: true, observationKey: 'turn' };
// 两组测试共用确定性的边界初始化，不依赖执行顺序。
function resetControlMocks() {
    mocks.serverId = 'server';
    mocks.accountId = 'account-a';
    mocks.read.mockReset().mockResolvedValue({ ok: true, snapshot });
    mocks.action.mockReset();
}
describe('desktop control lifecycle', () => {
    beforeEach(resetControlMocks);
    /** 每次点击直接消费本次读取值：缓存运行态不能把新终态错当追加。 */
    it('chooses a fresh start snapshot rather than the cached running snapshot', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        mocks.read.mockResolvedValueOnce({ ok: true, snapshot: { ...snapshot, state: 'completed', textSendMode: 'start' } });
        const start = vi.fn(async (isCurrent: () => boolean) => { expect(isCurrent()).toBe(true); return 'accepted' as const; });
        await act(async () => { expect(await hook.getCurrent().sendText('new turn', start)).toEqual({ outcome: 'accepted', mode: 'start' }); });
        expect(start).toHaveBeenCalledTimes(1);
        expect(mocks.action).not.toHaveBeenCalled();
    });

    /** 旧入口只能追加，读取变为可开始时也不能替调用者创建新轮次。 */
    it('does not let the steer-only entry start a new turn after a fresh terminal read', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, state: 'completed', textSendMode: 'start' } });
        await act(async () => { expect(await hook.getCurrent().steer('append only')).toBe(false); });
        expect(mocks.action).not.toHaveBeenCalled();
    });

    /** 缺字段与自相矛盾的快照都不能沿用缓存中的发送能力。 */
    it.each([
        { state: 'running', textSendMode: undefined },
        { state: 'running', textSendMode: 'start' },
        { state: 'completed', textSendMode: 'steer' },
    ])('rejects invalid fresh text authority %j', async (authority) => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        mocks.read.mockResolvedValueOnce({ ok: true, snapshot: { ...snapshot, ...authority } });
        const start = vi.fn(async () => 'accepted' as const);
        await act(async () => { expect((await hook.getCurrent().sendText('keep draft', start)).outcome).toBe('rejected'); });
        expect(start).not.toHaveBeenCalled(); expect(mocks.action).not.toHaveBeenCalled();
    });

    /** 单飞锁从读取开始持有，快速双击不会启动第二个读取或第二次投递。 */
    it('holds the click flight across the read and one start dispatch', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        const pending = createDeferred<unknown>();
        mocks.read.mockReturnValueOnce(pending.promise);
        const readsBefore = mocks.read.mock.calls.length;
        const start = vi.fn(async () => 'accepted' as const);
        let first!: ReturnType<ReturnType<typeof useDirectSessionControl>['sendText']>;
        await act(async () => { first = hook.getCurrent().sendText('once', start); });
        await act(async () => { expect((await hook.getCurrent().sendText('once', start)).outcome).toBe('unknown'); });
        expect(mocks.read.mock.calls.length).toBe(readsBefore + 1);
        await act(async () => { pending.resolve({ ok: true, snapshot: { ...snapshot, state: 'completed', textSendMode: 'start' } }); await first; });
        expect(start).toHaveBeenCalledTimes(1);
    });

    /** 换号后再返回同账号也属于新寿命，旧读取不可授权发送。 */
    it('discards an old click read after an account A to B to A cycle', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        const pending = createDeferred<unknown>();
        mocks.read.mockReturnValueOnce(pending.promise);
        const start = vi.fn(async () => 'accepted' as const);
        let first!: ReturnType<ReturnType<typeof useDirectSessionControl>['sendText']>;
        await act(async () => { first = hook.getCurrent().sendText('old account click', start); });
        mocks.accountId = 'account-b'; await hook.rerender();
        mocks.accountId = 'account-a'; await hook.rerender();
        await act(async () => { pending.resolve({ ok: true, snapshot: { ...snapshot, state: 'completed', textSendMode: 'start' } }); await first; });
        expect(start).not.toHaveBeenCalled(); expect(mocks.action).not.toHaveBeenCalled();
    });

    /** 读取被更新请求替代时，不拿较早返回的同目标快照放行。 */
    it('rejects a click read superseded by a newer refresh', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        const pending = createDeferred<unknown>();
        mocks.read.mockReturnValueOnce(pending.promise);
        const start = vi.fn(async () => 'accepted' as const);
        let first!: ReturnType<ReturnType<typeof useDirectSessionControl>['sendText']>;
        await act(async () => { first = hook.getCurrent().sendText('old read', start); });
        await act(async () => { await hook.getCurrent().refresh(); });
        await act(async () => { pending.resolve({ ok: true, snapshot: { ...snapshot, state: 'completed', textSendMode: 'start' } }); await first; });
        expect(start).not.toHaveBeenCalled(); expect(mocks.action).not.toHaveBeenCalled();
    });

    /** 新快照变为运行中时只追加到该轮次，未知回执锁定原操作不重投。 */
    it('uses the fresh steer turn and keeps an unknown operation locked', async () => {
        mocks.read.mockResolvedValueOnce({ ok: true, snapshot: { ...snapshot, state: 'completed', textSendMode: 'start' } });
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, turnId: 'new-running' } });
        mocks.action.mockResolvedValue({ ok: true, result: { status: 'unknown', reason: 'delivery_outcome_unknown' } });
        const start = vi.fn(async () => 'accepted' as const);
        await act(async () => { expect(await hook.getCurrent().sendText('append', start)).toEqual({ outcome: 'unknown', mode: 'steer' }); });
        await act(async () => { await hook.getCurrent().sendText('append', start); });
        expect(mocks.action).toHaveBeenCalledTimes(1);
        expect(mocks.action).toHaveBeenCalledWith(expect.objectContaining({ expectedTurnId: 'new-running', text: 'append' }), expect.anything());
        expect(start).not.toHaveBeenCalled();
    });

    /** 目标切换或停用后，旧回执不能清新草稿，也不能用旧 finally 释放新点击的锁。 */
    it.each(['target', 'enable_cycle'] as const)('keeps late start callbacks isolated across %s', async (change) => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        let params = { ...input };
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, state: 'completed', textSendMode: 'start' } });
        const hook = await renderHook(() => useDirectSessionControl(params));
        const oldReply = createDeferred<void>();
        const newReply = createDeferred<void>();
        const oldCurrentEffects = vi.fn();
        const oldStart = vi.fn(async (isCurrent: () => boolean) => {
            await oldReply.promise;
            if (isCurrent()) oldCurrentEffects();
            return 'accepted' as const;
        });
        const newStart = vi.fn(async () => { await newReply.promise; return 'accepted' as const; });
        let oldOperation!: ReturnType<ReturnType<typeof useDirectSessionControl>['sendText']>;
        let newOperation!: ReturnType<ReturnType<typeof useDirectSessionControl>['sendText']>;
        await act(async () => { oldOperation = hook.getCurrent().sendText('old text', oldStart); });
        expect(oldStart).toHaveBeenCalledTimes(1);
        params = change === 'target' ? { ...input, sessionId: 'other-session', machineId: 'other-machine' } : { ...input, enabled: false };
        await hook.rerender();
        if (change === 'enable_cycle') { params = { ...input }; await hook.rerender(); }
        await act(async () => { newOperation = hook.getCurrent().sendText('new text', newStart); });
        expect(hook.getCurrent().busy).toBe(true);
        await act(async () => { oldReply.resolve(); expect((await oldOperation).outcome).toBe('unknown'); });
        expect(oldCurrentEffects).not.toHaveBeenCalled();
        expect(hook.getCurrent().busy).toBe(true);
        const readsBefore = mocks.read.mock.calls.length;
        await act(async () => { await hook.getCurrent().sendText('duplicate while new is busy', newStart); });
        expect(mocks.read.mock.calls.length).toBe(readsBefore);
        expect(newStart).toHaveBeenCalledTimes(1);
        await act(async () => { newReply.resolve(); expect((await newOperation).outcome).toBe('accepted'); });
        expect(hook.getCurrent().busy).toBe(false);
    });

    /** 首次发送的旧已完成尾轮不能消除等待；新轮次快照到达才收起已过时的受理提示。 */
    it('clears an accepted start only after observing a new turn', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const oldTerminal = { ...snapshot, state: 'completed', textSendMode: 'start', requests: [] };
        mocks.read.mockResolvedValue({ ok: true, snapshot: oldTerminal });
        const hook = await renderHook(() => useDirectSessionControl(input));
        await act(async () => { await hook.getCurrent().sendText('start text', async () => 'accepted'); });
        expect(hook.getCurrent().outcome).toBe('accepted');
        expect(hook.getCurrent().outcomeKind).toBe('start');
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().outcome).toBe('accepted');
        mocks.read.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().outcome).toBe('accepted');
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...oldTerminal, turnId: 'new-completed-turn' } });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().outcome).toBeNull();
    });

    /** 新轮次观察先于受理返回时，迟到 ACK 不能重新显示已经过时的等待提示。 */
    it('does not restore an accepted start hint after its new turn was already observed', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, state: 'completed', textSendMode: 'start' } });
        const hook = await renderHook(() => useDirectSessionControl(input));
        const reply = createDeferred<'accepted'>();
        let sending!: ReturnType<ReturnType<typeof useDirectSessionControl>['sendText']>;
        await act(async () => { sending = hook.getCurrent().sendText('start text', () => reply.promise); });
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, turnId: 'new-turn', state: 'completed', textSendMode: 'start' } });
        await act(async () => { await hook.getCurrent().refresh(); });
        await act(async () => { reply.resolve('accepted'); expect((await sending).outcome).toBe('accepted'); });
        expect(hook.getCurrent().outcome).toBeNull();
    });

    /** 追加只接受自己 expectedTurnId 的终态；旧轮次或重复 running 都不是完成证据。 */
    it('clears an accepted steer hint only on its exact turn terminal result', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        mocks.action.mockResolvedValue({ ok: true, result: { status: 'accepted', turnId: 'turn' } });
        const hook = await renderHook(() => useDirectSessionControl(input));
        await act(async () => { await hook.getCurrent().steer('append text'); });
        expect(hook.getCurrent().outcome).toBe('accepted');
        expect(hook.getCurrent().outcomeKind).toBe('steer');
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, turnId: 'old-turn', state: 'completed' } });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().outcome).toBe('accepted');
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, state: 'completed' } });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().outcome).toBeNull();
    });

    /** 观察刷新只清理已确认受理的过时提示，未知投递和同轮次重投锁必须继续保留。 */
    it('keeps an unknown steer outcome and duplicate lock after terminal refresh', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        mocks.action.mockResolvedValue({ ok: true, result: { status: 'unknown', reason: 'delivery_outcome_unknown' } });
        const hook = await renderHook(() => useDirectSessionControl(input));
        await act(async () => { await hook.getCurrent().steer('append text'); });
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, state: 'completed' } });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().outcome).toBe('unknown');
        mocks.read.mockResolvedValue({ ok: true, snapshot });
        await act(async () => { await hook.getCurrent().steer('append text'); });
        expect(mocks.action).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().outcome).toBe('unknown');
    });

    it('keeps unknown approval outcomes and forbids repeating the same revision', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        mocks.action.mockResolvedValue({ ok: true, result: { status: 'unknown', reason: 'approval_outcome_unknown' } });
        await act(async () => { await hook.getCurrent().decide(request, 'allow_once'); });
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, state: 'completed', requests: [] } });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().outcome).toBe('unknown');
        expect(hook.getCurrent().outcomeKind).toBe('approval');
        mocks.read.mockResolvedValue({ ok: true, snapshot });
        await act(async () => { await hook.getCurrent().refresh(); });
        await act(async () => { await hook.getCurrent().decide(request, 'deny'); });
        expect(mocks.action).toHaveBeenCalledTimes(1);
        expect(mocks.action).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'linked', operationId: 'operation-once', expectedTurnId: 'turn', revision: 'rev' }), { serverId: 'server', onIssued: expect.any(Function) });
        expect(hook.getCurrent().outcome).toBe('unknown');
        expect(hook.getCurrent().isRequestLocked(request)).toBe(true);
    });
    it('does not allow an incomplete request or trust a steer receipt for another turn', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        await act(async () => { await hook.getCurrent().decide({ ...request, canDecide: false }, 'allow_once'); });
        expect(mocks.action).not.toHaveBeenCalled();
        mocks.action.mockResolvedValue({ ok: true, result: { status: 'accepted', turnId: 'other-turn' } });
        let accepted: boolean | undefined;
        await act(async () => { accepted = await hook.getCurrent().steer('追加说明'); });
        expect(accepted).toBe(false);
        expect(hook.getCurrent().outcome).toBe('unknown');
    });
    it.each(['steer', 'approval'] as const)('allows a deliberate retry after an explicit %s rejection', async (kind) => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        mocks.action.mockResolvedValue({ ok: false, error: 'desktop_control_unavailable', errorCode: 'provider_unavailable' });
        await act(async () => { if (kind === 'steer') await hook.getCurrent().steer('保留说明'); else await hook.getCurrent().decide(request, 'deny'); });
        expect(hook.getCurrent().outcome).toBe('rejected');
        await act(async () => { if (kind === 'steer') await hook.getCurrent().steer('保留说明'); else await hook.getCurrent().decide(request, 'deny'); });
        expect(mocks.action).toHaveBeenCalledTimes(2);
    });
    it('does not render a previous account snapshot for even one new-account frame', async () => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const frames: Array<{ account: string; turn: string | null }> = [];
        const hook = await renderHook(() => { const value = useDirectSessionControl(input); frames.push({ account: mocks.accountId, turn: value.snapshot?.turnId ?? null }); return value; });
        mocks.accountId = 'account-b';
        mocks.read.mockResolvedValue({ ok: false, error: 'offline', errorCode: 'offline' });
        await hook.rerender();
        expect(frames.filter((frame) => frame.account === 'account-b').every((frame) => frame.turn === null)).toBe(true);
    });
    it('discards previous-account read results', async () => {
        let finish!: (value: unknown) => void;
        mocks.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        mocks.accountId = 'account-b';
        mocks.read.mockResolvedValue({ ok: false, error: 'offline', errorCode: 'offline' });
        await hook.rerender();
        await act(async () => { finish({ ok: true, snapshot }); });
        expect(hook.getCurrent().snapshot).toBeNull();
        expect(hook.getCurrent().error).toBe('offline');
    });
});

/** 使用真实 profile 注册与别名解析，确保同服身份不被当作跨服越权。 */
describe('desktop control server aliases', () => {
    let createdProfileId: string | null = null;
    beforeEach(resetControlMocks);
    afterEach(async () => {
        // 只清理本例通过真实 owner 注册的合成 profile，不依赖全局存储清理。
        if (createdProfileId) {
            const profiles = await import('@/sync/domains/server/serverProfiles');
            profiles.removeServerProfile(createdProfileId);
            createdProfileId = null;
        }
        resetControlMocks();
    });
    it('refreshes and sends through the route alias of the authenticated server', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profile = profiles.upsertServerProfile({ serverUrl: 'https://control-alias.example.test', name: 'Synthetic' });
        createdProfileId = profile.id;
        profiles.setServerProfileIdentityForUrl(profile.serverUrl, 'srv_control_alias');
        mocks.serverId = 'srv_control_alias';
        mocks.read.mockResolvedValue({ ok: true, snapshot: { ...snapshot, state: 'completed', textSendMode: 'start' } });
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl({ ...input, serverId: profile.id }));
        await act(async () => { expect(await hook.getCurrent().refresh()).not.toBeNull(); });
        const start = vi.fn(async () => 'accepted' as const);
        await act(async () => { expect(await hook.getCurrent().sendText('synthetic', start)).toEqual({ outcome: 'accepted', mode: 'start' }); });
        expect(start).toHaveBeenCalledTimes(1);
        expect(mocks.read).toHaveBeenCalledWith({ machineId: 'machine', sessionId: 'linked' }, { serverId: profile.id });
        await hook.unmount();
    });
    it('still refuses a genuinely different server', async () => {
        mocks.serverId = 'server';
        mocks.read.mockClear();
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl({ ...input, serverId: 'other-server' }));
        const start = vi.fn(async () => 'accepted' as const);
        await act(async () => { expect(await hook.getCurrent().refresh()).toBeNull(); await hook.getCurrent().sendText('synthetic', start); });
        expect(start).not.toHaveBeenCalled();
        expect(mocks.read).not.toHaveBeenCalled();
        await hook.unmount();
    });
});
