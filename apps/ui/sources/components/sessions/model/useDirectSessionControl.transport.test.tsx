import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderHook } from '@/dev/testkit';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';

const transport = vi.hoisted(() => ({ rpc: vi.fn(), state: { machines: {} as Record<string, unknown> }, failAfterIssue: false }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: transport.rpc }));
vi.mock('@/sync/domains/state/storage', () => createStorageModuleStub({ storage: { getState: () => transport.state } }));
vi.mock('@/sync/store/hooks', () => ({ useActiveServerAccountScope: () => ({ serverId: 'server', accountId: 'account' }) }));
const request = { requestId: 'request', revision: 'rev', kind: 'command' as const, command: 'echo example', canDecide: true };
const input = { sessionId: 'linked', machineId: 'machine', serverId: 'server', enabled: true, observationKey: 'turn' };

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
