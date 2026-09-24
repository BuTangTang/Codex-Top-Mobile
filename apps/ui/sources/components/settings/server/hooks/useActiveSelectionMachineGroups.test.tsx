import * as React from 'react';

import { describe, expect, it, vi } from 'vitest';

import { useActiveSelectionMachineGroups } from './useActiveSelectionMachineGroups';
import { renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type ProbeProps = Readonly<{
    allMachines: any[];
    onValue: (value: ReturnType<typeof useActiveSelectionMachineGroups>) => void;
}>;

function Probe(props: ProbeProps) {
    const value = useActiveSelectionMachineGroups({
        activeServerSnapshot: { serverId: 'server-a', serverUrl: 'https://a.example.test', generation: 1 } as any,
        allMachines: props.allMachines as any,
        serverProfiles: [{ id: 'server-a', name: 'Server A', serverUrl: 'https://a.example.test', lastUsedAt: 1 }] as any,
        machineListByServerId: {},
        machineListStatusByServerId: {},
        settings: {
            serverSelectionGroups: null,
            serverSelectionActiveTargetKind: null,
            serverSelectionActiveTargetId: null,
        },
    });

    React.useEffect(() => {
        props.onValue(value);
    }, [value, props]);

    return null;
}

describe('useActiveSelectionMachineGroups', () => {
    it('filters revoked machines out of visible groups and hasAnyVisibleMachines', async () => {
        const captured: any[] = [];
        const allMachines = [
            { id: 'm-ok', revokedAt: null },
            { id: 'm-revoked', revokedAt: 123 },
        ];

        await renderScreen(<Probe allMachines={allMachines} onValue={(value) => captured.push(value)} />);

        const latest = captured.at(-1);
        expect(latest.visibleMachineGroups).toHaveLength(1);
        expect(latest.visibleMachineGroups[0].machines.map((m: any) => m.id)).toEqual(['m-ok']);
        expect(latest.hasAnyVisibleMachines).toBe(true);
    });

    it('reports no visible machines when all are revoked', async () => {
        const captured: any[] = [];
        const allMachines = [
            { id: 'm-revoked', revokedAt: 123 },
        ];

        await renderScreen(<Probe allMachines={allMachines} onValue={(value) => captured.push(value)} />);

        const latest = captured.at(-1);
        expect(latest.visibleMachineGroups[0].machines).toEqual([]);
        expect(latest.hasAnyVisibleMachines).toBe(false);
    });

    it('uses identity-backed profile ids for selected machine groups', async () => {
        const captured: any[] = [];
        function IdentityProbe() {
            const value = useActiveSelectionMachineGroups({
                activeServerSnapshot: {
                    serverId: 'srv_identity_active',
                    serverUrl: 'https://a.example.test',
                    generation: 1,
                } as any,
                allMachines: [],
                serverProfiles: [{
                    id: 'localhost-18829',
                    serverIdentityId: 'srv_identity_active',
                    name: 'Server A',
                    serverUrl: 'https://a.example.test',
                    lastUsedAt: 1,
                }] as any,
                machineListByServerId: {
                    srv_identity_active: [{ id: 'm-identity', revokedAt: null }] as any,
                },
                machineListStatusByServerId: {},
                settings: {
                    serverSelectionGroups: null,
                    serverSelectionActiveTargetKind: null,
                    serverSelectionActiveTargetId: null,
                },
            });

            React.useEffect(() => {
                captured.push(value);
            }, [value]);

            return null;
        }

        await renderScreen(<IdentityProbe />);

        const latest = captured.at(-1);
        expect(latest.visibleMachineGroups).toHaveLength(1);
        expect(latest.visibleMachineGroups[0].serverId).toBe('srv_identity_active');
        expect(latest.visibleMachineGroups[0].serverName).toBe('Server A');
        expect(latest.visibleMachineGroups[0].machines.map((machine: any) => machine.id)).toEqual(['m-identity']);
    });
});
