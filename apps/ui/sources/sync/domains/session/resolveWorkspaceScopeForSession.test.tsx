import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useWorkspaceScopeForSession', () => {
    afterEach(() => {
        storage.setState({
            sessions: {},
            machines: {},
            sessionListViewDataByServerId: {},
            isDataReady: true,
        } as never);
        standardCleanup();
    });

    it('keeps the selected scope stable when unrelated session fields change', async () => {
        storage.setState({
            sessions: {
                s1: {
                    id: 's1',
                    serverId: 'server-1',
                    active: true,
                    metadata: {
                        machineId: 'm1',
                        path: '/workspace',
                    },
                },
            },
            machines: {
                m1: {
                    id: 'm1',
                    active: true,
                    activeAt: 1,
                    metadata: {
                        host: 'tester.local',
                    },
                },
            },
            getProjectForSession: () => null,
            isDataReady: true,
        } as never);

        const { useWorkspaceScopeForSession } = await import('./resolveWorkspaceScopeForSession');
        let renderCount = 0;
        const hook = await renderHook(() => {
            renderCount += 1;
            return useWorkspaceScopeForSession('s1');
        });

        expect(hook.getCurrent()).toEqual({
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/workspace',
        });
        expect(renderCount).toBe(1);

        await act(async () => {
            const previousSession = storage.getState().sessions.s1;
            storage.setState({
                sessions: {
                    s1: {
                        ...previousSession,
                        thinking: true,
                        thinkingAt: 123,
                    },
                },
            } as never);
        });

        expect(hook.getCurrent()).toEqual({
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/workspace',
        });
        expect(renderCount).toBe(1);

        await hook.unmount();
    });

    it('keeps the workspace scope available when the machine is temporarily inactive', async () => {
        storage.setState({
            sessions: {
                s1: {
                    id: 's1',
                    serverId: 'server-1',
                    active: true,
                    metadata: {
                        machineId: 'm1',
                        path: '/workspace',
                    },
                },
            },
            machines: {
                m1: {
                    id: 'm1',
                    active: false,
                    activeAt: 1,
                    metadata: {
                        host: 'tester.local',
                    },
                },
            },
            getProjectForSession: () => null,
            isDataReady: true,
        } as never);

        const { useWorkspaceScopeForSession } = await import('./resolveWorkspaceScopeForSession');
        const hook = await renderHook(() => useWorkspaceScopeForSession('s1'));

        expect(hook.getCurrent()).toEqual({
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/workspace',
        });

        await hook.unmount();
    });
});
