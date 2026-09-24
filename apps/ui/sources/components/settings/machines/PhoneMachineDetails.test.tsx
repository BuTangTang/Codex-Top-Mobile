import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen } from '@/dev/testkit';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createUnistylesMock } from '@/dev/testkit/mocks/unistyles';

const state = vi.hoisted(() => ({ serverId: 'server-a', machine: { id: 'm1', active: false, activeAt: 0, metadata: { displayName: '真实电脑' } } as any, push: vi.fn(), projects: vi.fn() }));
vi.mock('expo-router', () => createExpoRouterMock({ router: { push: state.push } }).module);
vi.mock('react-native-unistyles', () => createUnistylesMock());
vi.mock('@/sync/domains/state/storage', () => ({ useMachine: () => state.machine }));
vi.mock('@/sync/store/hooks', () => ({ useActiveServerAccountScope: () => ({ serverId: state.serverId, accountId: 'a1' }), useProfile: () => ({ connectedServicesV2: [] }), useSettings: () => ({ connectedServicesProfileLabelByKey: {} }) }));
vi.mock('@/sync/ops/machineDirectSessions', () => ({ machineDirectSessionsProjectsList: state.projects }));
vi.mock('@/hooks/session/sessionListRuntimeClock', () => ({ useSessionListRuntimeNowMs: () => Date.now() }));
vi.mock('@/components/ui/lists/Item', () => createPassThroughModule(['Item']));
vi.mock('@/components/ui/lists/ItemGroup', () => createPassThroughModule(['ItemGroup']));
vi.mock('@/components/ui/lists/ItemList', () => createPassThroughModule(['ItemList']));
vi.mock('@/components/ui/icons/Icon', () => createPassThroughModule(['Icon']));

describe('phone computer detail', () => {
    beforeEach(() => { state.push.mockClear(); state.serverId = 'server-a'; state.machine.active = false; state.projects.mockReset(); state.projects.mockResolvedValue({ ok: true, projects: [], nativeCreate: false, unavailableReason: 'desktop_native_create_unavailable' }); });
    it('keeps unknown activity honest and opens history scoped to the actual machine', async () => {
        const { PhoneMachineDetails } = await import('./PhoneMachineDetails');
        const screen = await renderScreen(<PhoneMachineDetails machineId="m1" serverId="server-a" />);
        expect(screen.findByTestId('phone-machine-last-seen')?.props.detail).toBe('未知');
        expect(screen.findByTestId('phone-machine-identity')?.props.title).toBe('真实电脑');
        await act(async () => { screen.pressByTestId('phone-machine-view-sessions'); });
        expect(state.push).toHaveBeenCalledWith({ pathname: '/', params: { machineId: 'm1', serverId: 'server-a' } });
        expect(screen.findByTestId('phone-machine-projects-offline')).not.toBeNull();
    });
    it('reads real projects and opens an existing-conversation filter with identity rather than a path', async () => {
        state.machine.active = true;
        state.projects.mockResolvedValue({ ok: true, projects: [{ id: 'real-project', name: '真实项目', rootPaths: ['/synthetic'], available: true }], nativeCreate: false, unavailableReason: 'desktop_native_create_unavailable' });
        const { PhoneMachineDetails } = await import('./PhoneMachineDetails');
        const screen = await renderScreen(<PhoneMachineDetails machineId="m1" serverId="server-a" />);
        await act(async () => { screen.pressByTestId('phone-machine-project-real-project'); });
        expect(state.push).toHaveBeenCalledWith({ pathname: '/', params: { machineId: 'm1', serverId: 'server-a', projectId: 'real-project', sourceKey: 'codex:user' } });
    });
    it('does not navigate another server using an identically named machine', async () => {
        const { PhoneMachineDetails } = await import('./PhoneMachineDetails');
        const screen = await renderScreen(<PhoneMachineDetails machineId="m1" serverId="other-server" />);
        expect(screen.findByTestId('phone-machine-view-sessions')).toBeNull();
        expect(screen.findByTestId('phone-machine-unavailable')).not.toBeNull();
        expect(state.push).not.toHaveBeenCalled();
    });
});
