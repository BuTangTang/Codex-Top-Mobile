import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react-test-renderer';
import { renderHook } from '@/dev/testkit';
const mocks = vi.hoisted(() => ({ list: vi.fn(), account: 'a' }));
vi.mock('@/sync/ops/machineDirectSessions', () => ({ machineDirectSessionsProjectsList: mocks.list }));
vi.mock('@/sync/store/hooks', () => ({ useActiveServerAccountScope: () => ({ serverId: 's', accountId: mocks.account }), useProfile: () => ({ connectedServicesV2: [] }), useSettings: () => ({ connectedServicesProfileLabelByKey: {} }) }));
describe('phone desktop projects', () => {
    beforeEach(() => { mocks.list.mockReset(); mocks.account = 'a'; });
    it('preserves real project ids and distinguishes unavailable from an empty list', async () => {
        mocks.list.mockResolvedValue({ ok: true, projects: [{ id: 'real-id', name: '实际项目', rootPaths: ['/synthetic'], available: true }], nativeCreate: false, unavailableReason: 'desktop_native_create_unavailable' });
        const { usePhoneMachineProjects } = await import('./usePhoneMachineProjects');
        const hook = await renderHook(() => usePhoneMachineProjects({ machineId: 'm', serverId: 's', enabled: true }));
        expect(hook.getCurrent().projects?.[0]?.id).toBe('real-id');
        mocks.list.mockResolvedValue({ ok: false, error: 'config unavailable', errorCode: 'config' });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().projects).toBeNull();
        expect(hook.getCurrent().error).toBe('config unavailable');
    });
    it('discards a previous account response after switching identities', async () => {
        let resolveOld!: (value: unknown) => void;
        mocks.list.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
        mocks.list.mockResolvedValue({ ok: true, projects: [], nativeCreate: false, unavailableReason: 'desktop_native_create_unavailable' });
        const { usePhoneMachineProjects } = await import('./usePhoneMachineProjects');
        const hook = await renderHook(() => usePhoneMachineProjects({ machineId: 'm', serverId: 's', enabled: true }));
        mocks.account = 'b';
        await hook.rerender();
        await act(async () => { resolveOld({ ok: true, projects: [{ id: 'old', name: 'Old', rootPaths: ['/old'], available: true }] }); });
        expect(hook.getCurrent().projects).toEqual([]);
    });
});
