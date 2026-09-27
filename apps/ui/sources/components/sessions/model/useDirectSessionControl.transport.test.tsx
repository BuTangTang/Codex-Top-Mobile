import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { createDeferred, renderHook } from '@/dev/testkit';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';

const transport = vi.hoisted(() => ({ rpc: vi.fn(), state: { machines: {} as Record<string, unknown> }, failAfterIssue: false, activeServer: { serverId: 'server' } }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: transport.rpc }));
vi.mock('@/sync/domains/state/storage', () => createStorageModuleStub({ storage: { getState: () => transport.state } }));
vi.mock('@/sync/store/hooks', () => ({ useActiveServerAccountScope: () => ({ serverId: 'server', accountId: 'account' }) }));
vi.mock('react-native', async () => {
    const { createReactNativeAppStateEmitter, createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ AppState: createReactNativeAppStateEmitter('active').appState });
});
vi.mock('@/sync/sync', () => ({ sync: { refreshSessionMessages: async () => {} } }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => transport.activeServer,
    subscribeActiveServer: () => () => {},
}));
const request = { requestId: 'request', revision: 'rev', kind: 'command' as const, command: 'echo example', canDecide: true };
const input = { sessionId: 'linked', machineId: 'machine', serverId: 'server', enabled: true, observationKey: 'turn', prepareForMutation: async () => true };

describe('desktop control issuance boundary', () => {
    beforeEach(() => {
        transport.state.machines = {};
        transport.failAfterIssue = false;
        transport.rpc.mockReset().mockImplementation(async (call) => {
            if (call.method === 'daemon.directSessions.control.read') return { ok: true, snapshot: { v: 1, turnId: 'turn', state: 'running', requests: [request], textSendMode: 'steer' } };
            call.onIssued?.();
            if (transport.failAfterIssue) throw new Error('connection lost after issuance');
            return { ok: true, result: { status: 'accepted', turnId: 'turn' } };
        });
    });
    // 首次 CONTROL 复用真实 runtime 的 ATTACH/STATUS，冷点击可等准备但不能抢先写入。
    it.each(['ready', 'runner', 'offline'] as const)('waits for the viewer and status before cold control reads (%s)', async (statusKind) => {
        const attached = createDeferred<unknown>();
        const status = createDeferred<unknown>();
        transport.rpc.mockImplementation(async (call) => {
            if (call.method === 'daemon.directSessions.attach') return attached.promise;
            if (call.method === 'daemon.directSessions.status.get') return status.promise;
            if (call.method === 'daemon.directSessions.detach') return { ok: true };
            if (call.method === 'daemon.directSessions.control.read') return { ok: true, snapshot: { v: 1, turnId: 'turn', state: 'running', requests: [], textSendMode: 'steer' } };
            call.onIssued?.();
            return { ok: true, result: { status: 'accepted', turnId: 'turn' } };
        });
        const { useDirectSessionRuntime } = await import('./useDirectSessionRuntime');
        const hook = await renderHook(() => useDirectSessionRuntime({
            sessionId: 'linked', serverId: 'server',
            metadata: { directSessionV1: { v: 1, providerId: 'codex', machineId: 'machine',
                remoteSessionId: 'remote', source: { kind: 'codexHome', home: 'user' } } } as any,
        }));
        const calls = (method: string) => transport.rpc.mock.calls.filter(([call]) => call.method === `daemon.directSessions.${method}`);
        const start = vi.fn(async () => 'accepted' as const);
        try {
            expect(calls('attach')).toHaveLength(1);
            expect(calls('control.read')).toHaveLength(0);
            expect(calls('status.get')).toHaveLength(0);
            let sending!: Promise<unknown>;
            await act(async () => { sending = hook.getCurrent().control!.sendText('cold synthetic text', start, 'local-cold'); });
            expect(hook.getCurrent().control?.busy).toBe(true);
            expect(calls('attach')).toHaveLength(1);
            expect(calls('control.action')).toHaveLength(0);
            await act(async () => { attached.resolve({ ok: true, leaseId: calls('attach')[0]![0].payload.leaseId, expiresAtMs: 1 }); });
            expect(calls('status.get')).toHaveLength(1);
            expect(calls('control.read')).toHaveLength(0);
            await act(async () => {
                status.resolve({ ok: true, machineOnline: statusKind !== 'offline', runnerActive: statusKind === 'runner',
                    activity: 'idle', canTakeOverDirect: true, canTakeOverPersist: true, canForceStop: false,
                    observation: { v: 1, state: 'running', source: 'desktop', turnId: 'turn' } });
                expect(await sending).toEqual(statusKind === 'ready' ? { outcome: 'accepted', mode: 'steer' } : { outcome: 'rejected' });
            });
            expect(calls('control.action')).toHaveLength(statusKind === 'ready' ? 1 : 0);
            if (statusKind === 'ready') {
                expect(calls('control.action')[0]![0].payload).toMatchObject({ operationId: 'local-cold', expectedTurnId: 'turn' });
                const readsBefore = calls('control.read').length;
                await hook.rerender();
                expect(calls('control.read')).toHaveLength(readsBefore);
            } else {
                expect(calls('control.read')).toHaveLength(0);
                expect(hook.getCurrent().control?.snapshot).toBeNull();
            }
            expect(start).not.toHaveBeenCalled();
        } finally { await hook.unmount(); }
    });
    // 真实协议解析接受旧快照；缺失可选能力必须在当前 owner 拒绝文本发送。
    it('reads an older snapshot without granting text send authority', async () => {
        transport.rpc.mockResolvedValue({ ok: true, snapshot: { v: 1, turnId: 'turn', state: 'completed', requests: [] } });
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        const start = vi.fn(async () => 'accepted' as const);
        await act(async () => { expect((await hook.getCurrent().sendText('old producer text', start)).outcome).toBe('rejected'); });
        expect(hook.getCurrent().snapshot?.state).toBe('completed');
        expect(start).not.toHaveBeenCalled();
        expect(transport.rpc.mock.calls.every(([call]) => call.method === 'daemon.directSessions.control.read')).toBe(true);
    });

    // 真实机器目标解析在调用 RPC 前拒绝撤销目标，恢复目标后应允许用户再次操作。
    it.each(['steer', 'approval'] as const)('recovers from a pre-issuance %s target failure', async (kind) => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        transport.state.machines = { machine: { id: 'machine', revokedAt: 1 } };
        await act(async () => { if (kind === 'steer') await hook.getCurrent().steer('example'); else await hook.getCurrent().decide(request, 'deny'); });
        expect(transport.rpc.mock.calls.filter(([call]) => call.method === 'daemon.directSessions.control.action')).toHaveLength(0);
        expect(hook.getCurrent().outcome).toBe('rejected');
        transport.state.machines = {};
        await act(async () => { if (kind === 'steer') await hook.getCurrent().steer('example'); else await hook.getCurrent().decide(request, 'deny'); });
        expect(transport.rpc.mock.calls.filter(([call]) => call.method === 'daemon.directSessions.control.action')).toHaveLength(1);
    });
    // 使用真实适配层透传的 onIssued；已交给传输后的异常不能解锁重放。
    it.each(['steer', 'approval'] as const)('keeps a post-issuance %s disconnect unknown and locked', async (kind) => {
        const { useDirectSessionControl } = await import('./useDirectSessionControl');
        const hook = await renderHook(() => useDirectSessionControl(input));
        transport.failAfterIssue = true;
        await act(async () => { if (kind === 'steer') await hook.getCurrent().steer('example'); else await hook.getCurrent().decide(request, 'deny'); });
        expect(hook.getCurrent().outcome).toBe('unknown');
        await act(async () => { if (kind === 'steer') await hook.getCurrent().steer('example'); else await hook.getCurrent().decide(request, 'deny'); });
        expect(transport.rpc.mock.calls.filter(([call]) => call.method === 'daemon.directSessions.control.action')).toHaveLength(1);
    });
});
