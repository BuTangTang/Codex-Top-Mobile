import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';

import { useSessionMachineReachability } from './useSessionMachineReachability';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const baseMachine = {
    id: 'machine-1',
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    active: true,
    activeAt: 1,
    metadata: {
        host: 'machine',
        platform: 'darwin',
        happyCliVersion: '1',
        happyHomeDir: '.happy',
        homeDir: '/Users/test',
    },
    metadataVersion: 1,
    daemonState: null,
    daemonStateVersion: 0,
    revokedAt: null,
};

function baseSession(id: string, updatedAt: number) {
    return {
        id,
        seq: updatedAt,
        createdAt: 1,
        updatedAt,
        active: true,
        presence: 'online',
        metadata: {
            machineId: 'machine-1',
            path: `/repo/${id}`,
            homeDir: '/Users/test',
            host: 'machine',
        },
    };
}

afterEach(() => {
    standardCleanup();
});

describe('useSessionMachineReachability', () => {
    it('ignores unrelated session updates from background streams', async () => {
        const previousState = storage.getState();
        try {
            const serverId = getActiveServerSnapshot().serverId;
            const machine = { ...baseMachine, activeAt: Date.now() };
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    'machine-1': machine as any,
                },
                machineListByServerId: {
                    [serverId]: [machine as any],
                },
                sessions: {
                    visible: baseSession('visible', 1) as any,
                    background: baseSession('background', 1) as any,
                },
            }));

            const seen: Array<ReturnType<typeof useSessionMachineReachability>> = [];
            const hook = await renderHook(() => {
                const value = useSessionMachineReachability('visible');
                React.useEffect(() => {
                    seen.push(value);
                }, [value]);
                return value;
            }, { flushOptions: { cycles: 1, turns: 4 } });

            expect(hook.getCurrent()).toEqual({
                machineReachable: true,
                machineOnline: true,
                machineRpcTargetAvailable: true,
            });
            expect(seen).toHaveLength(1);

            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    sessions: {
                        ...state.sessions,
                        background: {
                            ...state.sessions.background,
                            seq: 2,
                            updatedAt: 2,
                        } as any,
                    },
                }));
            });

            await flushHookEffects({ cycles: 2, turns: 4 });

            expect(hook.getCurrent()).toEqual({
                machineReachable: true,
                machineOnline: true,
                machineRpcTargetAvailable: true,
            });
            expect(seen).toHaveLength(1);

            await hook.unmount();
        } finally {
            storage.setState(previousState, true);
        }
    });

    it('keeps reachability stable for machine heartbeats that do not change online state', async () => {
        const previousState = storage.getState();
        try {
            const serverId = getActiveServerSnapshot().serverId;
            const machine = { ...baseMachine, activeAt: Date.now() };
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    'machine-1': machine as any,
                },
                machineListByServerId: {
                    [serverId]: [machine as any],
                },
                sessions: {
                    visible: baseSession('visible', 1) as any,
                },
            }));

            const seen: Array<ReturnType<typeof useSessionMachineReachability>> = [];
            const hook = await renderHook(() => {
                const value = useSessionMachineReachability('visible');
                React.useEffect(() => {
                    seen.push(value);
                }, [value]);
                return value;
            }, { flushOptions: { cycles: 1, turns: 4 } });

            expect(hook.getCurrent()).toEqual({
                machineReachable: true,
                machineOnline: true,
                machineRpcTargetAvailable: true,
            });
            expect(seen).toHaveLength(1);

            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    machines: {
                        ...state.machines,
                        'machine-1': {
                            ...state.machines['machine-1'],
                            activeAt: Date.now(),
                        } as any,
                    },
                }));
            });

            await flushHookEffects({ cycles: 2, turns: 4 });

            expect(hook.getCurrent()).toEqual({
                machineReachable: true,
                machineOnline: true,
                machineRpcTargetAvailable: true,
            });
            expect(seen).toHaveLength(1);

            await hook.unmount();
        } finally {
            storage.setState(previousState, true);
        }
    });
});
