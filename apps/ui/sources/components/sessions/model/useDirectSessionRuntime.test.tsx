import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const machineDirectSessionStatusGetSpy = vi.hoisted(() => vi.fn());
const machineDirectSessionFollowPolicySetSpy = vi.hoisted(() => vi.fn());
const machineDirectSessionAttachSpy = vi.hoisted(() => vi.fn());
const machineDirectSessionDetachSpy = vi.hoisted(() => vi.fn());
const appStateEmitter = vi.hoisted(async () => {
  const { createReactNativeAppStateEmitter } = await import('@/dev/testkit/mocks/reactNative');
  return createReactNativeAppStateEmitter('active');
});

vi.mock('react-native', async () => {
  const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
  return createReactNativeWebMock({ AppState: (await appStateEmitter).appState });
});
const refreshSessionMessagesSpy = vi.hoisted(() => vi.fn());
const subscribeActiveServerSpy = vi.hoisted(() =>
  vi.fn<(listener: (snapshot: { serverId: string }) => void) => () => void>(() => () => {}),
);
const resolvePreferredServerIdForSessionIdSpy = vi.hoisted(() => vi.fn());
let activeServerSnapshot = { serverId: 'server-1' };

vi.mock('@/sync/ops/machineDirectSessions', () => ({
  machineDirectSessionStatusGet: machineDirectSessionStatusGetSpy,
  machineDirectSessionFollowPolicySet: machineDirectSessionFollowPolicySetSpy,
  machineDirectSessionAttach: machineDirectSessionAttachSpy,
  machineDirectSessionDetach: machineDirectSessionDetachSpy,
}));
vi.mock('@/sync/sync', () => ({
  sync: {
    refreshSessionMessages: refreshSessionMessagesSpy,
  },
}));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: () => activeServerSnapshot,
  subscribeActiveServer: subscribeActiveServerSpy,
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId', () => ({
  resolvePreferredServerIdForSessionId: (sessionId: string) => resolvePreferredServerIdForSessionIdSpy(sessionId),
}));

// 控制请求寿命有独立专项，此处聚焦原观察租约 owner。
vi.mock('./useDirectSessionControl', () => ({ useDirectSessionControl: () => null }));

type HookValue = ReturnType<typeof import('./useDirectSessionRuntime')['useDirectSessionRuntime']>;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function renderHarness(): Promise<{ getCurrent: () => HookValue; unmount: () => Promise<void> }> {
  const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
  const hook = await renderHook(() => useDirectSessionRuntime({
    sessionId: 'session-1',
    metadata: {
      directSessionV1: {
        v: 1,
        providerId: 'opencode',
        machineId: 'machine-1',
        remoteSessionId: 'remote-1',
        source: { kind: 'opencodeServer', directory: '/tmp/workspace' },
      },
    } as any,
  }));

  return {
    getCurrent: hook.getCurrent,
    unmount: hook.unmount,
  };
}

describe('useDirectSessionRuntime', () => {
  const observedStatus = {
    ok: true as const, machineOnline: true, activity: 'idle' as const, runnerActive: false,
    canTakeOverDirect: true, canTakeOverPersist: true, canForceStop: false,
    observation: { v: 1 as const, state: 'completed' as const, source: 'desktop' as const, turnId: 'turn-1' },
    notifications: { capability: 'explicit_lifecycle_v1' as const, enabled: false },
  };

  // 未关注页面必须先建立 viewer；成功订阅也不能把未知首帧改写为已完成。
  it('attaches an unfollowed viewer before status and preserves an unknown baseline', async () => {
    const attached = createDeferred<any>();
    machineDirectSessionAttachSpy.mockReturnValueOnce(attached.promise);
    machineDirectSessionStatusGetSpy.mockResolvedValue({ ...observedStatus,
      observation: { v: 1, state: 'unknown', reason: 'not_observed' }, externalControl: { canSend: true } });
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    try {
      expect(machineDirectSessionStatusGetSpy).not.toHaveBeenCalled();
      const input = machineDirectSessionAttachSpy.mock.calls[0]?.[0];
      expect(input).toMatchObject({ sessionId: 'session-1', ttlMs: 45_000, leaseId: expect.any(String) });
      await act(async () => { attached.resolve({ ok: true, leaseId: input.leaseId, expiresAtMs: 1 }); });
      expect(hook.getCurrent().status?.observation?.state).toBe('unknown');
      expect(hook.getCurrent().status?.externalControl?.canSend).toBe(true);
      expect(machineDirectSessionStatusGetSpy).toHaveBeenCalledTimes(1);
    } finally { await hook.unmount(); }
  });

  // 初次超时可能已在电脑建立租约，重试必须复用同一 ID，避免遗留多个 viewer。
  it('retries a failed attach with the same lease without querying stale status', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    machineDirectSessionAttachSpy.mockRejectedValueOnce(new Error('offline'));
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    try {
      expect(machineDirectSessionStatusGetSpy).not.toHaveBeenCalled();
      expect(hook.getCurrent().status?.observation?.state ?? 'unknown').toBe('unknown');
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      const inputs = machineDirectSessionAttachSpy.mock.calls.map(([input]) => input);
      expect(inputs).toHaveLength(2);
      expect(inputs[1].leaseId).toBe(inputs[0].leaseId);
      expect(hook.getCurrent().status?.observation?.state).toBe('completed');
    } finally { await hook.unmount(); vi.useRealTimers(); }
  });

  // 后台冷开页面不建 viewer；回到前台才走首个 attach 和状态查询。
  it('waits for foreground when mounted in background and releases only its own viewer', async () => {
    (await appStateEmitter).emit('background');
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    try {
      expect(machineDirectSessionAttachSpy).not.toHaveBeenCalled();
      expect(machineDirectSessionStatusGetSpy).not.toHaveBeenCalled();
      await act(async () => { (await appStateEmitter).emit('active'); });
      expect(hook.getCurrent().status?.observation?.state).toBe('completed');
      const second = await renderHarness();
      try {
        const leases = machineDirectSessionAttachSpy.mock.calls.map(([input]) => input.leaseId);
        expect(leases[1]).not.toBe(leases[0]);
        machineDirectSessionDetachSpy.mockRejectedValueOnce(new Error('offline'));
        await second.unmount();
        expect(machineDirectSessionDetachSpy.mock.calls[0][0].leaseId).toBe(leases[1]);
        await act(async () => { await hook.getCurrent().refreshNow(); });
        expect(hook.getCurrent().status?.observation?.state).toBe('completed');
        expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(2);
      } finally { await second.unmount(); }
    } finally { await hook.unmount(); }
  });

  // 后台立即撤回旧能力，旧请求晚到不能恢复 completed，前台必须建立新 viewer。
  it('releases on background and fences a late status before reattaching on resume', async () => {
    const oldStatus = createDeferred<any>();
    machineDirectSessionStatusGetSpy.mockResolvedValueOnce(observedStatus).mockReturnValueOnce(oldStatus.promise)
      .mockResolvedValue({ ...observedStatus, observation: { v: 1, state: 'running', source: 'desktop', turnId: 'next' } });
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    try {
      let pending!: Promise<unknown>;
      await act(async () => { pending = hook.getCurrent().refreshNow(); });
      await act(async () => { (await appStateEmitter).emit('background'); });
      expect(hook.getCurrent().status?.observation?.state).toBe('unknown');
      expect(machineDirectSessionDetachSpy).toHaveBeenCalledWith(expect.objectContaining({
        leaseId: machineDirectSessionAttachSpy.mock.calls[0][0].leaseId,
      }), { serverId: 'server-owned' });
      await act(async () => { oldStatus.resolve(observedStatus); await pending; });
      expect(hook.getCurrent().status?.observation?.state).toBe('unknown');
      await act(async () => { await hook.getCurrent().refreshNow(); });
      expect(machineDirectSessionStatusGetSpy).toHaveBeenCalledTimes(2);
      await act(async () => { (await appStateEmitter).emit('active'); });
      expect(machineDirectSessionAttachSpy.mock.calls[1][0].leaseId).not.toBe(machineDirectSessionAttachSpy.mock.calls[0][0].leaseId);
      expect(hook.getCurrent().status?.observation?.state).toBe('running');
    } finally { oldStatus.resolve(observedStatus); await hook.unmount(); }
  });

  // 换源时迟到的 attach 只能向原服务器补偿 detach，不得影响新 viewer。
  it.each(['success', 'failure'] as const)('isolates a late old-source attach %s on its captured server', async (outcome) => {
    const oldAttach = createDeferred<any>();
    machineDirectSessionAttachSpy.mockReturnValueOnce(oldAttach.promise);
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
    const initialProps = { sessionId: 'linked', serverId: 'old-server', metadata: { directSessionV1: {
      v: 1, providerId: 'codex', machineId: 'machine-1', remoteSessionId: 'native', source: { kind: 'codexHome', home: 'user' },
    } } as any };
    const hook = await renderHook((props: typeof initialProps) => useDirectSessionRuntime(props), { initialProps });
    try {
      const oldLeaseId = machineDirectSessionAttachSpy.mock.calls[0]?.[0].leaseId;
      await hook.rerender({ ...initialProps, serverId: 'new-server', metadata: { directSessionV1: {
        ...initialProps.metadata.directSessionV1, remoteSessionId: 'next-native',
      } } });
      const currentStatus = hook.getCurrent().status;
      await act(async () => {
        if (outcome === 'success') oldAttach.resolve({ ok: true, leaseId: oldLeaseId, expiresAtMs: Date.now() + 45_000 });
        else oldAttach.reject(new Error('old source unavailable'));
      });
      expect(machineDirectSessionDetachSpy).toHaveBeenLastCalledWith({ machineId: 'machine-1', sessionId: 'linked', leaseId: oldLeaseId }, { serverId: 'old-server' });
      expect(hook.getCurrent().status).toBe(currentStatus);
      expect(machineDirectSessionStatusGetSpy).toHaveBeenCalledTimes(1);
    } finally { await hook.unmount(); }
  });

  // 关注写后刷新状态可以换请求代次，但续租仍属同一页面 viewer。
  it('renews the same viewer across follow changes and detaches a late renewal after blur', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const renewal = createDeferred<any>();
    machineDirectSessionAttachSpy.mockImplementationOnce(async (input) => ({ ok: true, leaseId: input.leaseId, expiresAtMs: 1 }))
      .mockReturnValueOnce(renewal.promise);
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    machineDirectSessionFollowPolicySetSpy.mockResolvedValue({ ok: true, enabled: true, leaseActive: true, updatedAtMs: 1 });
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    try {
      const leaseId = machineDirectSessionAttachSpy.mock.calls[0][0].leaseId;
      await act(async () => { expect(await hook.getCurrent().setNotificationsEnabled(true)).toBe(true); });
      expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(1);
      expect(machineDirectSessionDetachSpy).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(2);
      expect(machineDirectSessionAttachSpy.mock.calls[1][0].leaseId).toBe(leaseId);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(2);
      await act(async () => { (await appStateEmitter).emit('inactive'); });
      await act(async () => { renewal.resolve({ ok: true, leaseId, expiresAtMs: Date.now() + 45_000 }); });
      expect(machineDirectSessionDetachSpy.mock.calls.map(([input]) => input.leaseId)).toEqual([leaseId, leaseId]);
      const before = machineDirectSessionStatusGetSpy.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(machineDirectSessionStatusGetSpy).toHaveBeenCalledTimes(before);
      expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(2);
    } finally { await hook.unmount(); vi.useRealTimers(); }
  });

  // 电脑时钟不参与本地 TTL 判断，响应晚于本次请求的有效窗口必须先重新续租。
  it('does not consume status from an attach response received after its local TTL', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const lateAttach = createDeferred<any>();
    machineDirectSessionAttachSpy.mockReturnValueOnce(lateAttach.promise);
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    try {
      const leaseId = machineDirectSessionAttachSpy.mock.calls[0][0].leaseId;
      await act(async () => { await vi.advanceTimersByTimeAsync(45_001); });
      await act(async () => { lateAttach.resolve({ ok: true, leaseId, expiresAtMs: Date.now() + 9_000_000 }); });
      expect(machineDirectSessionStatusGetSpy).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(machineDirectSessionAttachSpy.mock.calls[1][0].leaseId).toBe(leaseId);
      expect(hook.getCurrent().status?.observation?.state).toBe('completed');
    } finally { await hook.unmount(); vi.useRealTimers(); }
  });

  // 正文请求挂起时租约仍续期；续期也挂起并过期后，旧 status 不能晚到恢复完成态。
  it('expires a stalled renewal independently of transcript refresh', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const renewal = createDeferred<any>();
    const transcript = createDeferred<void>();
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValueOnce(undefined).mockReturnValueOnce(transcript.promise);
    machineDirectSessionAttachSpy.mockImplementationOnce(async (input) => ({ ok: true, leaseId: input.leaseId, expiresAtMs: 1 }))
      .mockReturnValueOnce(renewal.promise);
    const hook = await renderHarness();
    try {
      let pending!: Promise<unknown>;
      await act(async () => { pending = hook.getCurrent().refreshNow(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(hook.getCurrent().status?.observation?.state).toBe('unknown');
      await act(async () => { transcript.resolve(); await pending; });
      expect(hook.getCurrent().status?.observation?.state).toBe('unknown');
    } finally { await hook.unmount(); vi.useRealTimers(); }
  });

  // 失焦只停网络需求，保留可见 overlay 底下的 Direct 身份与正文布局。
  it('keeps direct metadata while an unfocused retained surface releases and reopens its viewer', async () => {
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
    const metadata = { directSessionV1: { v: 1, providerId: 'codex', machineId: 'machine', remoteSessionId: 'native',
      source: { kind: 'codexHome', home: 'user' } } } as any;
    const hook = await renderHook((viewerActive: boolean) => useDirectSessionRuntime({
      sessionId: 'linked', metadata, viewerActive,
    }), { initialProps: false });
    try {
      expect(hook.getCurrent().directSessionLink).not.toBeNull();
      expect(machineDirectSessionAttachSpy).not.toHaveBeenCalled();
      await hook.rerender(true);
      const oldLease = machineDirectSessionAttachSpy.mock.calls[0][0].leaseId;
      const link = hook.getCurrent().directSessionLink;
      await hook.rerender(false);
      expect(hook.getCurrent().directSessionLink).toBe(link);
      expect(hook.getCurrent().status?.observation?.state).toBe('unknown');
      expect(machineDirectSessionDetachSpy.mock.calls[0][0].leaseId).toBe(oldLease);
      await hook.rerender(true);
      expect(machineDirectSessionAttachSpy.mock.calls[1][0].leaseId).not.toBe(oldLease);
    } finally { await hook.unmount(); }
  });

  // 已传给子组件的旧刷新闭包不能在失焦或卸载后重新建立网络观察。
  it('does not resurrect a viewer through a retained refresh callback after blur or unmount', async () => {
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
    const metadata = { directSessionV1: { v: 1, providerId: 'codex', machineId: 'machine', remoteSessionId: 'native',
      source: { kind: 'codexHome', home: 'user' } } } as any;
    const hook = await renderHook((viewerActive: boolean) => useDirectSessionRuntime({
      sessionId: 'linked', metadata, viewerActive,
    }), { initialProps: true });
    const refresh = hook.getCurrent().refreshNow;
    try {
      await hook.rerender(false);
      await act(async () => { expect(await refresh()).toBeNull(); });
      expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(1);
    } finally { await hook.unmount(); }
    await act(async () => { expect(await refresh()).toBeNull(); });
    expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(1);
  });

  // 续期被拒绝后即使下次续期成功，拒绝前发出的旧状态也必须失效。
  it('fences a status issued before a rejected renewal even after the lease recovers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const oldStatus = createDeferred<any>();
    machineDirectSessionStatusGetSpy.mockResolvedValueOnce(observedStatus).mockReturnValueOnce(oldStatus.promise);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    machineDirectSessionAttachSpy.mockImplementationOnce(async (input) => ({ ok: true, leaseId: input.leaseId, expiresAtMs: 1 }))
      .mockResolvedValueOnce({ ok: false, errorCode: 'machine_offline', error: 'offline' });
    const hook = await renderHarness();
    try {
      let pending!: Promise<unknown>;
      await act(async () => { pending = hook.getCurrent().refreshNow(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(17_000); });
      expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(3);
      await act(async () => { oldStatus.resolve(observedStatus); await pending; });
      expect(hook.getCurrent().status?.observation?.state).toBe('unknown');
    } finally { await hook.unmount(); vi.useRealTimers(); }
  });

  // 慢历史不能挡住运行态或断线；同一正文刷新未结束时不堆积下一批请求/等待者。
  it.each(['running', 'failure'] as const)('publishes %s while transcript refresh is pending and keeps transcript single-flight', async (outcome) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const transcript = createDeferred<void>();
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValueOnce(undefined).mockReturnValueOnce(transcript.promise).mockResolvedValue(undefined);
    const hook = await renderHarness();
    try {
      expect(hook.getCurrent().status?.observation?.state).toBe('completed');
      if (outcome === 'running') machineDirectSessionStatusGetSpy.mockResolvedValue({ ...observedStatus,
        observation: { v: 1, state: 'running', source: 'desktop', turnId: 'new-turn' } });
      else machineDirectSessionStatusGetSpy.mockRejectedValue(new Error('offline'));
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(hook.getCurrent().status?.observation?.state).toBe(outcome === 'running' ? 'running' : 'unknown');
      expect(refreshSessionMessagesSpy).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(machineDirectSessionStatusGetSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(refreshSessionMessagesSpy).toHaveBeenCalledTimes(2);
      await act(async () => { transcript.reject(new Error('history unavailable')); });
      expect(hook.getCurrent().status?.observation?.state).toBe(outcome === 'running' ? 'running' : 'unknown');
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(refreshSessionMessagesSpy).toHaveBeenCalledTimes(3);
    } finally { transcript.resolve(); await hook.unmount(); vi.useRealTimers(); }
  });

  // 正文请求完成只清除单飞标记，后台或卸载后不能自动发起下一次刷新。
  it('does not restart polling or publish status when an old transcript completes after background', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const transcript = createDeferred<void>();
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockReturnValue(transcript.promise);
    const hook = await renderHarness();
    try {
      expect(hook.getCurrent().status?.observation?.state).toBe('completed');
      await act(async () => { (await appStateEmitter).emit('background'); });
      const paused = hook.getCurrent().status;
      await act(async () => { transcript.resolve(); await vi.advanceTimersByTimeAsync(60_000); });
      expect(hook.getCurrent().status).toBe(paused);
      expect(machineDirectSessionStatusGetSpy).toHaveBeenCalledTimes(1);
      expect(refreshSessionMessagesSpy).toHaveBeenCalledTimes(1);
    } finally { await hook.unmount(); vi.useRealTimers(); }
  });

  // 相同生命周期与关注内容保持稳定，断线后明确未知并撤回旧能力。
  it('retains equivalent observation identity and invalidates stale lifecycle and notifications', async () => {
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    const before = hook.getCurrent();
    machineDirectSessionStatusGetSpy.mockResolvedValue(JSON.parse(JSON.stringify(observedStatus)));
    await act(async () => { await hook.getCurrent().refreshNow(); });
    expect(hook.getCurrent()).toBe(before);
    machineDirectSessionStatusGetSpy.mockRejectedValue(new Error('offline'));
    await act(async () => { await hook.getCurrent().refreshNow(); });
    expect(hook.getCurrent().status?.observation).toEqual({ v: 1, state: 'unknown', reason: 'source_unavailable' });
    expect(hook.getCurrent().status?.notifications).toBeUndefined();
    await hook.unmount();
  });

  // 写入在真实 RPC 回复前不乐观改变关注值，快速重复点击只发一份。
  it('sets follow with scoped RPC, canonical readback and one in-flight mutation', async () => {
    const follow = createDeferred<any>();
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    machineDirectSessionFollowPolicySetSpy.mockReturnValue(follow.promise);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    let operation!: Promise<boolean | null>;
    await act(async () => { operation = hook.getCurrent().setNotificationsEnabled(true); });
    expect(hook.getCurrent().notificationsBusy).toBe(true);
    expect(hook.getCurrent().status?.notifications?.enabled).toBe(false);
    await expect(hook.getCurrent().setNotificationsEnabled(true)).resolves.toBeNull();
    expect(machineDirectSessionFollowPolicySetSpy).toHaveBeenCalledTimes(1);
    expect(machineDirectSessionFollowPolicySetSpy).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-1', sessionId: 'session-1', remoteSessionId: 'remote-1', enabled: true,
    }), { serverId: 'server-owned' });
    machineDirectSessionStatusGetSpy.mockResolvedValue({ ...observedStatus, notifications: { ...observedStatus.notifications, enabled: true } });
    await act(async () => {
      follow.resolve({ ok: true, enabled: true, leaseActive: true, updatedAtMs: 1,
        notifications: { ...observedStatus.notifications, enabled: true } });
      expect(await operation).toBe(true);
    });
    expect(hook.getCurrent().notificationsBusy).toBe(false);
    expect(hook.getCurrent().status?.notifications?.enabled).toBe(true);
    await hook.unmount();
  });

  // 真实关注会先回写 directSessionV1；回复前后回声都不能换租约或让 busy 失去清理 owner。
  it.each(['before_reply', 'during_readback', 'after_reply'] as const)('keeps one lease and clears follow busy after a metadata echo %s', async (phase) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const follow = createDeferred<any>();
    const readback = createDeferred<any>();
    const followedStatus = { ...observedStatus, notifications: { ...observedStatus.notifications, enabled: true } };
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    machineDirectSessionFollowPolicySetSpy.mockReturnValueOnce(follow.promise);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
    const metadata = { directSessionV1: { v: 1, providerId: 'codex', machineId: 'machine-1',
      remoteSessionId: 'native-1', source: { kind: 'codexHome', home: 'user' } } } as any;
    const hook = await renderHook((current: typeof metadata) => useDirectSessionRuntime({
      sessionId: 'linked', metadata: current,
    }), { initialProps: metadata });
    try {
      const leaseId = machineDirectSessionAttachSpy.mock.calls[0][0].leaseId;
      let operation!: Promise<boolean | null>;
      await act(async () => { operation = hook.getCurrent().setNotificationsEnabled(true); });
      expect(hook.getCurrent().notificationsBusy).toBe(true);
      const echoed = { directSessionV1: { ...metadata.directSessionV1,
        followPolicyV1: { v: 1, policy: 'background_follow', updatedAtMs: 1, generation: 'follow-generation' },
      } };
      machineDirectSessionStatusGetSpy.mockResolvedValue(followedStatus);
      if (phase === 'before_reply') await hook.rerender(echoed);
      else if (phase === 'during_readback') machineDirectSessionStatusGetSpy.mockReturnValueOnce(readback.promise);
      await act(async () => { follow.resolve({ ok: true, enabled: true, leaseActive: true, updatedAtMs: 1,
        notifications: followedStatus.notifications }); });
      if (phase === 'during_readback') {
        expect(hook.getCurrent().notificationsBusy).toBe(true);
        await hook.rerender(echoed);
      }
      let result: boolean | null = null;
      await act(async () => { readback.resolve(followedStatus); result = await operation; });
      if (phase === 'after_reply') await hook.rerender(echoed);
      expect(hook.getCurrent().notificationsBusy).toBe(false);
      expect(result).toBe(true);
      expect(hook.getCurrent().status?.notifications?.enabled).toBe(true);
      // 通知检查点和活动时间会持续回写，同一源必须一直使用同一条 viewer 租约。
      for (let checkpoint = 1; checkpoint <= 3; checkpoint += 1) {
        await hook.rerender({ directSessionV1: { ...echoed.directSessionV1,
          notificationStateV1: { v: 1, identity: 'synthetic-source', generation: 'follow-generation',
            observation: observedStatus.observation, lastKnown: observedStatus.observation,
            cursor: `cursor-${checkpoint}`, claims: {},
          },
          lastKnownActivityAtMs: checkpoint,
        } });
      }
      machineDirectSessionFollowPolicySetSpy.mockResolvedValue({ ok: true, enabled: false, leaseActive: true, updatedAtMs: 2,
        notifications: observedStatus.notifications });
      machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
      await act(async () => { expect(await hook.getCurrent().setNotificationsEnabled(false)).toBe(true); });
      expect(hook.getCurrent().notificationsBusy).toBe(false);
      expect(machineDirectSessionDetachSpy).not.toHaveBeenCalled();
      expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(machineDirectSessionAttachSpy).toHaveBeenCalledTimes(2);
      expect(machineDirectSessionAttachSpy.mock.calls[1][0].leaseId).toBe(leaseId);
    } finally {
      follow.resolve({ ok: false, errorCode: 'machine_offline', error: 'offline' });
      readback.resolve(followedStatus);
      await hook.unmount();
      vi.useRealTimers();
    }
  });

  // owner 缓存可在无渲染时变化；主动刷新取消旧关注引用时必须同时撤回 busy。
  it('clears follow busy when a fresh lookup changes the owning server during a pending follow', async () => {
    const follow = createDeferred<any>();
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    machineDirectSessionFollowPolicySetSpy.mockReturnValueOnce(follow.promise);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    try {
      const oldLeaseId = machineDirectSessionAttachSpy.mock.calls[0][0].leaseId;
      let operation!: Promise<boolean | null>;
      await act(async () => { operation = hook.getCurrent().setNotificationsEnabled(true); });
      resolvePreferredServerIdForSessionIdSpy.mockReturnValue('new-owner');
      await act(async () => { await hook.getCurrent().refreshNow(); });
      expect(hook.getCurrent().notificationsBusy).toBe(false);
      expect(machineDirectSessionDetachSpy).toHaveBeenCalledWith(expect.objectContaining({ leaseId: oldLeaseId }), { serverId: 'server-owned' });
      expect(machineDirectSessionAttachSpy.mock.calls[1][0].leaseId).not.toBe(oldLeaseId);
      await act(async () => { follow.resolve({ ok: true, enabled: true, leaseActive: true, updatedAtMs: 1 });
        expect(await operation).toBeNull(); });
      expect(hook.getCurrent().status?.notifications?.enabled).toBe(false);
      expect(hook.getCurrent().notificationsBusy).toBe(false);
    } finally { follow.resolve({ ok: false, errorCode: 'machine_offline', error: 'offline' }); await hook.unmount(); }
  });

  // 旧会话写入可完成，但迟到回复不得改写新会话、清除新操作的忙状态或弹出旧错误。
  it.each(['success', 'failure'] as const)('ignores a late follow %s after changing the linked session', async (outcome) => {
    const oldFollow = createDeferred<any>();
    const newFollow = createDeferred<any>();
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    machineDirectSessionFollowPolicySetSpy.mockReturnValueOnce(oldFollow.promise).mockReturnValueOnce(newFollow.promise);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
    const metadata = { directSessionV1: { v: 1, providerId: 'codex', machineId: 'machine-1',
      remoteSessionId: 'native-1', source: { kind: 'codexHome', home: 'user' } } } as any;
    const hook = await renderHook((sessionId: string) => useDirectSessionRuntime({ sessionId, metadata }), { initialProps: 'old-linked' });
    let oldOperation!: Promise<boolean | null>;
    await act(async () => { oldOperation = hook.getCurrent().setNotificationsEnabled(true); });
    await hook.rerender('new-linked');
    let newOperation!: Promise<boolean | null>;
    await act(async () => { newOperation = hook.getCurrent().setNotificationsEnabled(true); });
    await act(async () => {
      if (outcome === 'success') oldFollow.resolve({ ok: true, enabled: true, leaseActive: true, updatedAtMs: 1,
        notifications: { ...observedStatus.notifications, enabled: true } });
      else oldFollow.reject(new Error('old private error'));
      expect(await oldOperation).toBeNull();
    });
    expect(hook.getCurrent().notificationsBusy).toBe(true);
    expect(hook.getCurrent().status?.notifications?.enabled).toBe(false);
    await act(async () => {
      newFollow.resolve({ ok: false, errorCode: 'machine_offline', error: 'offline' });
      expect(await newOperation).toBe(false);
    });
    expect(hook.getCurrent().notificationsBusy).toBe(false);
    expect(machineDirectSessionFollowPolicySetSpy.mock.calls.map(([input]) => input.sessionId)).toEqual(['old-linked', 'new-linked']);
    await hook.unmount();
  });

  it('does not write follow policy when a fresh probe no longer advertises notifications', async () => {
    machineDirectSessionStatusGetSpy.mockResolvedValue(observedStatus);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const hook = await renderHarness();
    machineDirectSessionStatusGetSpy.mockResolvedValue({ ...observedStatus, notifications: undefined });
    await act(async () => { expect(await hook.getCurrent().setNotificationsEnabled(true)).toBe(false); });
    expect(machineDirectSessionFollowPolicySetSpy).not.toHaveBeenCalled();
    expect(hook.getCurrent().notificationsBusy).toBe(false);
    await hook.unmount();
  });

  beforeEach(async () => {
    (await appStateEmitter).emit('active');
    machineDirectSessionAttachSpy.mockReset();
    machineDirectSessionAttachSpy.mockImplementation(async (input) => ({
      ok: true, leaseId: input.leaseId, expiresAtMs: Date.now() + input.ttlMs,
    }));
    machineDirectSessionDetachSpy.mockReset();
    machineDirectSessionDetachSpy.mockResolvedValue({ ok: true, detached: true });
    activeServerSnapshot = { serverId: 'server-1' };
    machineDirectSessionStatusGetSpy.mockReset();
    machineDirectSessionFollowPolicySetSpy.mockReset();
    refreshSessionMessagesSpy.mockReset();
    subscribeActiveServerSpy.mockClear();
    resolvePreferredServerIdForSessionIdSpy.mockReset();
    resolvePreferredServerIdForSessionIdSpy.mockReturnValue('server-owned');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not resolve session server ownership while the runtime hook is disabled', async () => {
    const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
    const hook = await renderHook(() => useDirectSessionRuntime({
      sessionId: 'disabled-direct-runtime',
      metadata: null,
      enabled: false,
    }));

    expect(resolvePreferredServerIdForSessionIdSpy).not.toHaveBeenCalled();
    expect(hook.getCurrent().directSessionLink).toBeNull();
    expect(hook.getCurrent().status).toBeNull();

    await hook.unmount();
  });

  it('does not emit an unhandled rejection when status fails before transcript refresh completes', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const refreshMessages = createDeferred<void>();
      machineDirectSessionStatusGetSpy.mockRejectedValueOnce(Object.assign(new Error('RPC method not available'), {
        rpcErrorCode: 'RPC_METHOD_NOT_AVAILABLE',
      }));
      refreshSessionMessagesSpy.mockReturnValueOnce(refreshMessages.promise);

      const harness = await renderHarness();
      expect(unhandled).toEqual([]);

      await act(async () => {
        refreshMessages.resolve();
        await refreshMessages.promise;
      });

      expect(unhandled).toEqual([]);
      expect(harness.getCurrent().status).toBeNull();
      await harness.unmount();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  // 首次探测失败时没有可用的新状态，刷新调用应正常返回空值。
  it('returns null instead of rejecting when the initial status refresh fails', async () => {
    const refreshMessages = createDeferred<void>();
    machineDirectSessionStatusGetSpy.mockRejectedValue(Object.assign(new Error('RPC method not available'), {
      rpcErrorCode: 'RPC_METHOD_NOT_AVAILABLE',
    }));
    refreshSessionMessagesSpy.mockReturnValue(refreshMessages.promise);

    const harness = await renderHarness();
    try {
      // 状态失败及时返回，不再用慢正文维持已结束的 status 单飞请求。
      await act(async () => { expect(await harness.getCurrent().refreshNow()).toBeNull(); });
      expect(harness.getCurrent().status).toBeNull();
      expect(refreshSessionMessagesSpy).toHaveBeenCalledTimes(1);
    } finally {
      refreshMessages.resolve();
      await harness.unmount();
    }
  });

  // 网络错误和服务端拒绝都不能把上次可写状态当成本次探测成功。
  it.each(['transport_error', 'unavailable_response'] as const)(
    'preserves cached activity but removes displayed send capability after %s',
    async (failure) => {
      const writableStatus = {
        ok: true as const,
        machineOnline: true,
        activity: 'idle' as const,
        runnerActive: false,
        canTakeOverDirect: true,
        canTakeOverPersist: true,
        canForceStop: false,
        externalControl: { canSend: true },
      };
      machineDirectSessionStatusGetSpy.mockResolvedValue(writableStatus);
      refreshSessionMessagesSpy.mockResolvedValue(undefined);
      const harness = await renderHarness();
      expect(harness.getCurrent().status).toEqual(writableStatus);

      if (failure === 'transport_error') {
        machineDirectSessionStatusGetSpy.mockRejectedValue(new Error('machine disconnected'));
      } else {
        machineDirectSessionStatusGetSpy.mockResolvedValue({
          ok: false,
          errorCode: 'provider_unavailable',
          error: 'desktop owner unavailable',
        });
      }

      let refreshed: unknown = writableStatus;
      await act(async () => {
        refreshed = await harness.getCurrent().refreshNow();
      });

      expect(refreshed).toBeNull();
      expect(harness.getCurrent().status).toEqual(expect.objectContaining({
        activity: writableStatus.activity, machineOnline: writableStatus.machineOnline,
      }));
      expect(harness.getCurrent().status?.externalControl).toBeUndefined();
      machineDirectSessionStatusGetSpy.mockResolvedValue(writableStatus);
      await act(async () => { await harness.getCurrent().refreshNow(); });
      expect(harness.getCurrent().status?.externalControl?.canSend).toBe(true);
      await harness.unmount();
    },
  );

  // 新响应不再声明桌面能力时，不能合并保留旧响应里的授权。
  it('drops the previous external capability when the next successful response omits it', async () => {
    const baseStatus = {
      ok: true as const,
      machineOnline: true,
      activity: 'idle' as const,
      runnerActive: false,
      canTakeOverDirect: true,
      canTakeOverPersist: true,
      canForceStop: false,
    };
    machineDirectSessionStatusGetSpy.mockResolvedValue({ ...baseStatus, externalControl: { canSend: true } });
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const harness = await renderHarness();

    machineDirectSessionStatusGetSpy.mockResolvedValue(baseStatus);
    let refreshed: unknown = null;
    await act(async () => {
      refreshed = await harness.getCurrent().refreshNow();
    });

    expect(refreshed).toEqual(baseStatus);
    expect(harness.getCurrent().status).toEqual(baseStatus);
    await harness.unmount();
  });

  // 轮询返回内容相同的新对象时保持引用稳定，能力撤回时才发布新状态。
  it('keeps equivalent external capabilities stable and publishes capability revocation', async () => {
    const writableStatus = {
      ok: true as const,
      machineOnline: true,
      activity: 'idle' as const,
      runnerActive: false,
      canTakeOverDirect: true,
      canTakeOverPersist: true,
      canForceStop: false,
      externalControl: { canSend: true },
    };
    machineDirectSessionStatusGetSpy.mockResolvedValue(writableStatus);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const harness = await renderHarness();
    const beforeRefresh = harness.getCurrent();

    machineDirectSessionStatusGetSpy.mockResolvedValue({ ...writableStatus, externalControl: { canSend: true } });
    await act(async () => {
      await harness.getCurrent().refreshNow();
    });
    expect(harness.getCurrent()).toBe(beforeRefresh);

    const unavailableStatus = {
      ...writableStatus,
      externalControl: { canSend: false, unavailableReason: 'desktop_disconnected' },
    };
    machineDirectSessionStatusGetSpy.mockResolvedValue(unavailableStatus);
    await act(async () => {
      await harness.getCurrent().refreshNow();
    });
    expect(harness.getCurrent().status).toEqual(unavailableStatus);
    expect(harness.getCurrent()).not.toBe(beforeRefresh);
    await harness.unmount();
  });

  it('does not reset the direct-session runtime when the active server changes but the session owner stays the same', async () => {
    const server1Status = createDeferred<any>();

    machineDirectSessionStatusGetSpy
      .mockImplementationOnce(async () => await server1Status.promise)
      .mockResolvedValue({ ok: true, machineOnline: true, activity: 'running', runnerActive: true });
    refreshSessionMessagesSpy.mockResolvedValue(undefined);

    const harness = await renderHarness();

    expect(machineDirectSessionStatusGetSpy).toHaveBeenCalledTimes(1);
    expect(machineDirectSessionStatusGetSpy.mock.calls[0]?.[1]).toEqual({ serverId: 'server-owned' });

    await act(async () => {
      activeServerSnapshot = { serverId: 'server-2' };
      const subscriber = subscribeActiveServerSpy.mock.calls[0]?.[0];
      if (subscriber) subscriber(activeServerSnapshot);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    });

    expect(machineDirectSessionStatusGetSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      server1Status.resolve({ ok: true, machineOnline: true, activity: 'idle', runnerActive: false });
      await server1Status.promise;
    });

    expect(harness.getCurrent().status).not.toBeNull();
    await harness.unmount();
  });

  it('re-resolves the preferred owner on refresh calls even when the active server is unchanged', async () => {
    machineDirectSessionStatusGetSpy
      .mockResolvedValueOnce({ ok: true, machineOnline: true, activity: 'idle', runnerActive: false })
      .mockResolvedValueOnce({ ok: true, machineOnline: true, activity: 'running', runnerActive: true })
      .mockResolvedValue({ ok: true, machineOnline: true, activity: 'running', runnerActive: true });
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    resolvePreferredServerIdForSessionIdSpy
      .mockReturnValueOnce('server-owned-a')
      .mockReturnValueOnce('server-owned-a')
      .mockReturnValueOnce('server-owned-b')
      .mockReturnValue('server-owned-b');

    const harness = await renderHarness();

    expect(machineDirectSessionStatusGetSpy.mock.calls[0]?.[1]).toEqual({ serverId: 'server-owned-a' });

    await act(async () => {
      await harness.getCurrent().refreshNow();
    });

    expect(machineDirectSessionStatusGetSpy.mock.calls[1]?.[1]).toEqual({ serverId: 'server-owned-b' });
    await harness.unmount();
  });

  // 同服务器切换电脑、原生会话或目录时，旧探测不能为新目标提供发送能力。
  it.each(['machine', 'nativeSession', 'source', 'session'] as const)(
    'isolates in-flight capabilities when the %s target changes on the same server',
    async (changedField) => {
      const oldStatus = createDeferred<any>();
      const unavailable = { ok: true, machineOnline: true, activity: 'idle', runnerActive: false, externalControl: { canSend: false } };
      machineDirectSessionStatusGetSpy.mockReturnValueOnce(oldStatus.promise).mockResolvedValue(unavailable);
      refreshSessionMessagesSpy.mockResolvedValue(undefined);
      const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
      const initialProps = {
        sessionId: 'session-1',
        metadata: { directSessionV1: {
          v: 1, providerId: 'opencode', machineId: 'machine-1', remoteSessionId: 'remote-1',
          source: { kind: 'opencodeServer', directory: '/tmp/workspace' },
        } } as any,
      };
      const hook = await renderHook((props: typeof initialProps) => useDirectSessionRuntime(props), { initialProps });
      const oldRefresh = hook.getCurrent().refreshNow();
      const next = { ...initialProps, metadata: { directSessionV1: { ...initialProps.metadata.directSessionV1 } } };
      if (changedField === 'machine') next.metadata.directSessionV1.machineId = 'machine-2';
      if (changedField === 'nativeSession') next.metadata.directSessionV1.remoteSessionId = 'remote-2';
      if (changedField === 'source') next.metadata.directSessionV1.source = { kind: 'opencodeServer', directory: '/tmp/other' };
      if (changedField === 'session') next.sessionId = 'session-2';
      try {
        const oldLeaseId = machineDirectSessionAttachSpy.mock.calls[0][0].leaseId;
        await hook.rerender(next);
        expect(machineDirectSessionStatusGetSpy).toHaveBeenCalledTimes(2);
        expect(machineDirectSessionDetachSpy).toHaveBeenCalledWith(expect.objectContaining({ leaseId: oldLeaseId }), { serverId: 'server-owned' });
        expect(machineDirectSessionAttachSpy.mock.calls[1][0].leaseId).not.toBe(oldLeaseId);
        await act(async () => {
          oldStatus.resolve({ ...unavailable, externalControl: { canSend: true } });
          await oldRefresh;
        });
        await expect(oldRefresh).resolves.toBeNull();
        expect(hook.getCurrent().status?.externalControl?.canSend).toBe(false);
      } finally {
        oldStatus.resolve(unavailable);
        await hook.unmount();
      }
    },
  );

  // 旧目标失败不能撤回新目标已获得的能力，复用既有 generation 归属约束。
  it('does not clear a new target capability when the old target refresh fails', async () => {
    const oldStatus = createDeferred<any>();
    const writable = { ok: true, machineOnline: true, activity: 'idle', runnerActive: false, externalControl: { canSend: true } };
    machineDirectSessionStatusGetSpy.mockReturnValueOnce(oldStatus.promise).mockResolvedValue(writable);
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
    const initialProps = {
      sessionId: 'session-1',
      metadata: { directSessionV1: {
        v: 1, providerId: 'opencode', machineId: 'machine-1', remoteSessionId: 'remote-1',
        source: { kind: 'opencodeServer', directory: '/tmp/workspace' },
      } } as any,
    };
    const hook = await renderHook((props: typeof initialProps) => useDirectSessionRuntime(props), { initialProps });
    const oldRefresh = hook.getCurrent().refreshNow();
    try {
      await hook.rerender({ ...initialProps, sessionId: 'session-2' });
      expect(hook.getCurrent().status?.externalControl?.canSend).toBe(true);
      await act(async () => { oldStatus.reject(new Error('old connection lost')); await oldRefresh; });
      expect(hook.getCurrent().status?.externalControl?.canSend).toBe(true);
    } finally {
      await hook.unmount();
    }
  });

  it('keeps the returned runtime object stable across unrelated parent rerenders', async () => {
    machineDirectSessionStatusGetSpy.mockResolvedValue({ ok: true, machineOnline: true, activity: 'idle', runnerActive: false });
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
    const metadata = {
      directSessionV1: {
        v: 1,
        providerId: 'opencode',
        machineId: 'machine-1',
        remoteSessionId: 'remote-1',
        source: { kind: 'opencodeServer', directory: '/tmp/workspace' },
      },
    } as any;

    const hook = await renderHook(() => useDirectSessionRuntime({
      sessionId: 'session-1',
      metadata,
    }));

    const first = hook.getCurrent();
    await hook.rerender();

    expect(hook.getCurrent()).toBe(first);
    await hook.unmount();
  });

  it('keeps the returned runtime object stable when equivalent metadata is recreated', async () => {
    machineDirectSessionStatusGetSpy.mockResolvedValue({ ok: true, machineOnline: true, activity: 'idle', runnerActive: false });
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
    const createMetadata = () => ({
      directSessionV1: {
        v: 1,
        providerId: 'opencode',
        machineId: 'machine-1',
        remoteSessionId: 'remote-1',
        source: { kind: 'opencodeServer', directory: '/tmp/workspace' },
      },
    } as any);

    const hook = await renderHook((metadata: ReturnType<typeof createMetadata>) => useDirectSessionRuntime({
      sessionId: 'session-1',
      metadata,
    }), {
      initialProps: createMetadata(),
    });

    const first = hook.getCurrent();
    await hook.rerender(createMetadata());

    expect(hook.getCurrent()).toBe(first);
    await hook.unmount();
  });

  it('treats equivalent status payloads as unchanged', async () => {
    const { areDirectSessionRuntimeStatusesEqual } = await import('./useDirectSessionRuntime');

    expect(areDirectSessionRuntimeStatusesEqual(
      { ok: true, machineOnline: true, activity: 'idle', runnerActive: false } as any,
      { ok: true, machineOnline: true, activity: 'idle', runnerActive: false } as any,
    )).toBe(true);
    expect(areDirectSessionRuntimeStatusesEqual(
      { ok: true, machineOnline: true, activity: 'idle', runnerActive: false } as any,
      { ok: true, machineOnline: true, activity: 'running', runnerActive: true } as any,
    )).toBe(false);
  });
});
