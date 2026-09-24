import { createDeferred, renderHook } from '@/dev/testkit';
import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UseDirectSessionRuntimeResult } from './useDirectSessionRuntime';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const machineDirectSessionTakeoverSpy = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const machineDirectSessionTakeoverPersistSpy = vi.hoisted(() => vi.fn(async () => ({ ok: true, converted: true })));
const refreshSessionMessagesSpy = vi.hoisted(() => vi.fn(async () => {}));
const refreshSessionsSpy = vi.hoisted(() => vi.fn(async () => {}));
const showDirectSessionTakeoverDialogSpy = vi.hoisted(() =>
  vi.fn<() => Promise<{ action: 'direct' | 'persisted' | null; forceStop: boolean }>>(async () => ({ action: null, forceStop: false })),
);
const modalAlertSpy = vi.hoisted(() => vi.fn());
const resolvePreferredServerIdForSessionIdSpy = vi.hoisted(() => vi.fn());

let activeServerId = 'server-1';

vi.mock('@/components/sessions/directSessions/takeover/showDirectSessionTakeoverDialog', () => ({
  showDirectSessionTakeoverDialog: showDirectSessionTakeoverDialogSpy,
}));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            alert: modalAlertSpy,
            confirm: vi.fn(async () => false),
        },
    }).module;
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string) => key,
    });
});
vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: () => ({ serverId: activeServerId }),
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId', () => ({
  resolvePreferredServerIdForSessionId: (sessionId: string) => resolvePreferredServerIdForSessionIdSpy(sessionId),
}));
vi.mock('@/sync/ops/machineDirectSessions', () => ({
  machineDirectSessionTakeover: machineDirectSessionTakeoverSpy,
  machineDirectSessionTakeoverPersist: machineDirectSessionTakeoverPersistSpy,
}));
vi.mock('@/sync/sync', () => ({
  sync: {
    refreshSessionMessages: refreshSessionMessagesSpy,
    refreshSessions: refreshSessionsSpy,
  },
}));

type HookValue = ReturnType<typeof import('./useDirectSessionTakeover')['useDirectSessionTakeover']>;

// 复用现有 hook 测试入口，并允许验证只读会话不会取得桌面发送权限。
async function renderHarness(
  directSessionRuntime: Pick<UseDirectSessionRuntimeResult, 'directSessionLink' | 'status' | 'refreshNow'>,
  hasWriteAccess = true,
): Promise<{ getCurrent: () => HookValue; unmount: () => void }> {
  const { useDirectSessionTakeover } = await import('./useDirectSessionTakeover');

  return renderHook(
    (runtime: Pick<UseDirectSessionRuntimeResult, 'directSessionLink' | 'status' | 'refreshNow'>) =>
      useDirectSessionTakeover({ sessionId: 's1', hasWriteAccess, directSessionRuntime: runtime }),
    {
      initialProps: directSessionRuntime,
    },
  );
}

describe('useDirectSessionTakeover', () => {
  const directSessionLink: NonNullable<UseDirectSessionRuntimeResult['directSessionLink']> = {
    v: 1,
    providerId: 'codex',
    machineId: 'machine-1',
    remoteSessionId: 'vendor-session-1',
    source: { kind: 'codexHome', home: 'user' },
  };
  const status: NonNullable<UseDirectSessionRuntimeResult['status']> = {
    ok: true,
    machineOnline: true,
    runnerActive: false,
    activity: 'running',
    canTakeOverDirect: true,
    canTakeOverPersist: true,
    canForceStop: false,
  };

  beforeEach(() => {
    activeServerId = 'server-1';
    resolvePreferredServerIdForSessionIdSpy.mockReset();
    resolvePreferredServerIdForSessionIdSpy.mockReturnValue('server-owned');
    machineDirectSessionTakeoverSpy.mockReset();
    machineDirectSessionTakeoverPersistSpy.mockReset();
    machineDirectSessionTakeoverSpy.mockResolvedValue({ ok: true });
    machineDirectSessionTakeoverPersistSpy.mockResolvedValue({ ok: true, converted: true });
    refreshSessionMessagesSpy.mockReset();
    refreshSessionMessagesSpy.mockResolvedValue(undefined);
    refreshSessionsSpy.mockReset();
    refreshSessionsSpy.mockResolvedValue(undefined);
    showDirectSessionTakeoverDialogSpy.mockReset();
    showDirectSessionTakeoverDialogSpy.mockResolvedValue({ action: null, forceStop: false });
    modalAlertSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 路由切换只改变后续操作的 owner，已经发送给 A 的请求仍保留原目标。
  it.each(['success', 'failure'] as const)('isolates an old session takeover %s from the new session and its busy state', async (outcome) => {
    const { useDirectSessionTakeover } = await import('./useDirectSessionTakeover');
    const requestA = createDeferred<{ ok: true }>();
    const requestB = createDeferred<{ ok: true; converted: true }>();
    machineDirectSessionTakeoverSpy.mockReturnValueOnce(requestA.promise);
    machineDirectSessionTakeoverPersistSpy.mockReturnValueOnce(requestB.promise);
    const refreshA = vi.fn(async () => status);
    const refreshB = vi.fn(async () => status);
    const runtimeA = { directSessionLink, status, refreshNow: refreshA };
    const runtimeB = { directSessionLink: { ...directSessionLink, machineId: 'machine-B', remoteSessionId: 'vendor-B' }, status, refreshNow: refreshB };
    const harness = await renderHook(({ sessionId, runtime }: { sessionId: string; runtime: typeof runtimeA }) =>
      useDirectSessionTakeover({ sessionId, hasWriteAccess: true, directSessionRuntime: runtime }),
      { initialProps: { sessionId: 'A', runtime: runtimeA } });
    let pendingA!: Promise<boolean>;
    await act(async () => { pendingA = harness.getCurrent().requestTakeover('direct'); });
    expect(harness.getCurrent().takeoverInFlight).toBe('direct');
    await harness.rerender({ sessionId: 'B', runtime: runtimeB });
    expect(harness.getCurrent().takeoverInFlight).toBeNull();
    let pendingB!: Promise<boolean>;
    await act(async () => { pendingB = harness.getCurrent().requestTakeover('persisted'); });
    expect(harness.getCurrent().takeoverInFlight).toBe('persisted');
    expect(machineDirectSessionTakeoverSpy).toHaveBeenCalledWith({ machineId: 'machine-1', sessionId: 'A' }, { serverId: 'server-owned' });
    expect(machineDirectSessionTakeoverPersistSpy).toHaveBeenCalledWith({ machineId: 'machine-B', sessionId: 'B' }, { serverId: 'server-owned' });
    await act(async () => {
      if (outcome === 'success') requestA.resolve({ ok: true });
      else requestA.reject(new Error('old session failure'));
      await pendingA;
    });
    expect(harness.getCurrent().takeoverInFlight).toBe('persisted');
    expect(modalAlertSpy).not.toHaveBeenCalled();
    expect(refreshSessionMessagesSpy).not.toHaveBeenCalled();
    expect(refreshB).toHaveBeenCalledTimes(1);
    await act(async () => { requestB.resolve({ ok: true, converted: true }); await pendingB; });
    expect(harness.getCurrent().takeoverInFlight).toBeNull();
    expect(refreshSessionMessagesSpy).toHaveBeenCalledWith('B');
    expect(machineDirectSessionTakeoverSpy).toHaveBeenCalledTimes(1);
    expect(machineDirectSessionTakeoverPersistSpy).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });

  it('does not dispatch a stale action after fresh status resolves on another session', async () => {
    const { useDirectSessionTakeover } = await import('./useDirectSessionTakeover');
    const fresh = createDeferred<typeof status>();
    const runtime = { directSessionLink, status, refreshNow: vi.fn(async () => status).mockReturnValueOnce(fresh.promise) };
    const harness = await renderHook(({ sessionId }: { sessionId: string }) =>
      useDirectSessionTakeover({ sessionId, hasWriteAccess: true, directSessionRuntime: runtime }),
      { initialProps: { sessionId: 'A' } });
    let pending!: Promise<boolean>;
    await act(async () => { pending = harness.getCurrent().requestTakeover('direct'); });
    await harness.rerender({ sessionId: 'B' });
    await act(async () => { fresh.resolve(status); await pending; });
    expect(machineDirectSessionTakeoverSpy).not.toHaveBeenCalled();
    expect(machineDirectSessionTakeoverPersistSpy).not.toHaveBeenCalled();
    expect(harness.getCurrent().takeoverInFlight).toBeNull();
    await harness.unmount();
  });

  it('deduplicates same-session takeover clicks while fresh capability is pending', async () => {
    const fresh = createDeferred<typeof status>();
    const refreshNow = vi.fn(async () => status).mockReturnValueOnce(fresh.promise);
    const harness = await renderHarness({ directSessionLink, status, refreshNow });
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = harness.getCurrent().requestTakeover('direct');
      second = harness.getCurrent().requestTakeover('persisted');
    });
    expect(refreshNow).toHaveBeenCalledTimes(1);
    await act(async () => { fresh.resolve(status); await Promise.all([first, second]); });
    expect(machineDirectSessionTakeoverSpy).toHaveBeenCalledTimes(1);
    expect(machineDirectSessionTakeoverPersistSpy).not.toHaveBeenCalled();
    await harness.unmount();
  });

  it('keeps cancel, failure reporting, and retry available on the current session', async () => {
    const { Modal } = await import('@/modal');
    vi.mocked(Modal.confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    const refreshNow = vi.fn(async () => ({ ...status, canForceStop: true }));
    const harness = await renderHarness({ directSessionLink, status, refreshNow });
    await act(async () => { expect(await harness.getCurrent().requestTakeover('direct')).toBe(false); });
    expect(machineDirectSessionTakeoverSpy).not.toHaveBeenCalled();
    expect(harness.getCurrent().takeoverInFlight).toBeNull();
    machineDirectSessionTakeoverSpy.mockRejectedValueOnce(new Error('takeover failed'));
    await act(async () => { expect(await harness.getCurrent().requestTakeover('direct')).toBe(false); });
    expect(modalAlertSpy).toHaveBeenCalledWith('common.error', 'takeover failed');
    expect(harness.getCurrent().takeoverInFlight).toBeNull();
    await act(async () => { expect(await harness.getCurrent().requestTakeover('direct')).toBe(true); });
    expect(machineDirectSessionTakeoverSpy).toHaveBeenCalledTimes(2);
    expect(machineDirectSessionTakeoverSpy).toHaveBeenLastCalledWith(
      { machineId: 'machine-1', sessionId: 's1', forceStop: true }, { serverId: 'server-owned' },
    );
    expect(harness.getCurrent().takeoverInFlight).toBeNull();
    await harness.unmount();
  });

  it('uses the owning session server when footer takeover is requested after an active-server switch', async () => {
    const refreshNow = vi.fn(async () => status);
    const harness = await renderHarness({ directSessionLink, status, refreshNow });

    activeServerId = 'server-2';
    await act(async () => {
      await harness.getCurrent().requestTakeover('direct');
    });

    expect(machineDirectSessionTakeoverSpy).toHaveBeenCalledWith(
      { machineId: 'machine-1', sessionId: 's1' },
      { serverId: 'server-owned' },
    );
    await harness.unmount();
  });

  it('re-checks direct-session status before manual takeover after a server switch', async () => {
    const refreshNow = vi.fn(async () => ({
      ...status,
      machineOnline: false,
    }));
    const harness = await renderHarness({ directSessionLink, status, refreshNow });

    activeServerId = 'server-2';
    let ready = true;
    await act(async () => {
      ready = await harness.getCurrent().requestTakeover('direct');
    });

    expect(ready).toBe(false);
    expect(refreshNow).toHaveBeenCalledTimes(1);
    expect(machineDirectSessionTakeoverSpy).not.toHaveBeenCalled();
    expect(modalAlertSpy).toHaveBeenCalledWith('common.error', 'chatFooter.directSessionMachineOffline');
    await harness.unmount();
  });

  it('uses the owning session server when send takeover is confirmed after an active-server switch', async () => {
    const refreshNow = vi.fn(async () => status);
    showDirectSessionTakeoverDialogSpy.mockResolvedValueOnce({ action: 'direct', forceStop: false });
    const harness = await renderHarness({ directSessionLink, status, refreshNow });

    activeServerId = 'server-2';
    await act(async () => {
      await harness.getCurrent().ensureReadyForSend();
    });

    expect(showDirectSessionTakeoverDialogSpy).toHaveBeenCalledWith({
      canTakeOverDirect: true,
      canTakeOverPersist: true,
      canForceStop: false,
    });
    expect(machineDirectSessionTakeoverSpy).toHaveBeenCalledWith(
      { machineId: 'machine-1', sessionId: 's1' },
      { serverId: 'server-owned' },
    );
    await harness.unmount();
  });

  // 旧调用继续返回布尔值，不把已有 runner 误标为外部桌面发送。
  it('re-checks direct-session status before prompting for send takeover after a server switch', async () => {
    const refreshNow = vi.fn(async () => ({
      ...status,
      runnerActive: true,
    }));
    const harness = await renderHarness({ directSessionLink, status, refreshNow });

    activeServerId = 'server-2';
    let ready: boolean | 'external' = false;
    await act(async () => {
      ready = await harness.getCurrent().ensureReadyForSend();
    });

    expect(ready).toBe(true);
    expect(refreshNow).toHaveBeenCalledTimes(1);
    expect(showDirectSessionTakeoverDialogSpy).not.toHaveBeenCalled();
    expect(machineDirectSessionTakeoverSpy).not.toHaveBeenCalled();
    await harness.unmount();
  });

  // 把本次探测确认的外部发送路径直接交给调用者，避免随后读取旧 React 状态选路。
  it('allows an explicit text send using the freshly confirmed desktop capability without takeover', async () => {
    const refreshNow = vi.fn(async () => ({ ...status, externalControl: { canSend: true } }));
    const harness = await renderHarness({ directSessionLink, status, refreshNow });

    let ready: boolean | 'external' = false;
    await act(async () => {
      ready = await harness.getCurrent().ensureReadyForSend({ intent: 'text' });
    });

    expect(ready).toBe('external');
    expect(refreshNow).toHaveBeenCalledTimes(1);
    expect(showDirectSessionTakeoverDialogSpy).not.toHaveBeenCalled();
    expect(machineDirectSessionTakeoverSpy).not.toHaveBeenCalled();
    expect(machineDirectSessionTakeoverPersistSpy).not.toHaveBeenCalled();
    await harness.unmount();
  });

  // 缓存可写也不能替代本次授权，文本发送失败时保留显式接管由用户另行选择。
  it.each([
    { reason: 'missing capability', nextStatus: status },
    { reason: 'revoked capability', nextStatus: { ...status, externalControl: { canSend: false } } },
    { reason: 'failed refresh', nextStatus: null },
    { reason: 'offline machine', nextStatus: { ...status, machineOnline: false, externalControl: { canSend: true } } },
  ])('rejects an explicit text send after $reason without using cached permission or taking over', async ({ nextStatus }) => {
    const cachedStatus = { ...status, externalControl: { canSend: true } };
    const refreshNow = vi.fn(async () => nextStatus);
    const harness = await renderHarness({ directSessionLink, status: cachedStatus, refreshNow });

    let ready: boolean | 'external' = true;
    await act(async () => {
      ready = await harness.getCurrent().ensureReadyForSend({ intent: 'text' });
    });

    expect(ready).toBe(false);
    expect(refreshNow).toHaveBeenCalledTimes(1);
    expect(showDirectSessionTakeoverDialogSpy).not.toHaveBeenCalled();
    expect(machineDirectSessionTakeoverSpy).not.toHaveBeenCalled();
    expect(machineDirectSessionTakeoverPersistSpy).not.toHaveBeenCalled();
    await harness.unmount();
  });

  // 附件和执行任务等旧调用没有声明文本意图，不能借用桌面文本能力。
  it('keeps the existing takeover flow for calls without an explicit text intent', async () => {
    const writableStatus = { ...status, externalControl: { canSend: true } };
    const refreshNow = vi.fn(async () => writableStatus);
    const harness = await renderHarness({ directSessionLink, status: writableStatus, refreshNow });

    let ready: boolean | 'external' = true;
    await act(async () => {
      ready = await harness.getCurrent().ensureReadyForSend();
    });

    expect(ready).toBe(false);
    expect(showDirectSessionTakeoverDialogSpy).toHaveBeenCalledTimes(1);
    expect(machineDirectSessionTakeoverSpy).not.toHaveBeenCalled();
    await harness.unmount();
  });

  // 桌面能力不能越过会话写权限，也不能隐式升级为接管操作。
  it('rejects an explicit desktop text send when the session is read-only', async () => {
    const writableStatus = { ...status, externalControl: { canSend: true } };
    const refreshNow = vi.fn(async () => writableStatus);
    const harness = await renderHarness({ directSessionLink, status: writableStatus, refreshNow }, false);

    let ready: boolean | 'external' = true;
    await act(async () => {
      ready = await harness.getCurrent().ensureReadyForSend({ intent: 'text' });
    });

    expect(ready).toBe(false);
    expect(showDirectSessionTakeoverDialogSpy).not.toHaveBeenCalled();
    expect(machineDirectSessionTakeoverSpy).not.toHaveBeenCalled();
    expect(machineDirectSessionTakeoverPersistSpy).not.toHaveBeenCalled();
    await harness.unmount();
  });

  // 已有 runner 始终返回 true，即使同次响应还声明了桌面能力也不切换路径。
  it.each([undefined, { canSend: true }])('preserves the active runner path for an explicit text send with external capability %j', async (externalControl) => {
    const refreshNow = vi.fn(async () => ({ ...status, runnerActive: true, externalControl }));
    const harness = await renderHarness({ directSessionLink, status, refreshNow });

    let ready: boolean | 'external' = false;
    await act(async () => {
      ready = await harness.getCurrent().ensureReadyForSend({ intent: 'text' });
    });

    expect(ready).toBe(true);
    expect(showDirectSessionTakeoverDialogSpy).not.toHaveBeenCalled();
    expect(machineDirectSessionTakeoverSpy).not.toHaveBeenCalled();
    await harness.unmount();
  });

  // 桌面可写能力不会删除用户主动选择的接管入口。
  it('keeps explicit takeover available when desktop text control is advertised', async () => {
    const writableStatus = { ...status, externalControl: { canSend: true } };
    const refreshNow = vi.fn(async () => writableStatus);
    const harness = await renderHarness({ directSessionLink, status: writableStatus, refreshNow });

    let ready = false;
    await act(async () => {
      ready = await harness.getCurrent().requestTakeover('direct');
    });

    expect(ready).toBe(true);
    expect(machineDirectSessionTakeoverSpy).toHaveBeenCalledWith(
      { machineId: 'machine-1', sessionId: 's1' },
      { serverId: 'server-owned' },
    );
    await harness.unmount();
  });
});
