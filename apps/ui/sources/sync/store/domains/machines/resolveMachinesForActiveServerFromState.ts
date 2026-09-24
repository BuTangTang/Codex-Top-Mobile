import type { Machine } from '@/sync/domains/state/storageTypes';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { isMachineVisibleForLaunchSelection } from '@/sync/domains/machines/identity/filterVisibleMachines';

function isVisibleMachine(machine: Machine): boolean {
    return isMachineVisibleForLaunchSelection(machine);
}

function sortVisibleMachines(a: Machine, b: Machine): number {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return a.id.localeCompare(b.id);
}

export function resolveVisibleMachinesForActiveServerFromState(state: any): Machine[] {
    const activeServerId = String(getActiveServerSnapshot().serverId ?? '').trim();
    const machineListByServerId = state?.machineListByServerId ?? {};
    const canonicalMachinesById = state?.machines && typeof state.machines === 'object'
        ? state.machines as Record<string, Machine | null | undefined>
        : {};
    const hasActiveServerMachineList = activeServerId
        ? Object.prototype.hasOwnProperty.call(machineListByServerId, activeServerId)
        : false;
    const activeServerMachines = activeServerId ? machineListByServerId[activeServerId] : null;
    const rawSourceMachines = activeServerId && hasActiveServerMachineList
        ? (Array.isArray(activeServerMachines) ? activeServerMachines : [])
        : Object.values(state?.machines ?? {});
    const sourceMachines = rawSourceMachines.map((machine: unknown) => {
        if (!machine || typeof machine !== 'object' || typeof (machine as Machine).id !== 'string') return machine;
        return canonicalMachinesById[(machine as Machine).id] ?? machine;
    });

    return sourceMachines
        .filter((machine): machine is Machine => Boolean(
            machine
            && typeof machine === 'object'
            && typeof (machine as { id?: unknown }).id === 'string',
        ))
        .filter(isVisibleMachine)
        .sort(sortVisibleMachines);
}

export function resolveMachineForActiveServerFromState(state: any, machineIdRaw: unknown): Machine | null {
    const machineId = typeof machineIdRaw === 'string' ? machineIdRaw.trim() : '';
    if (!machineId) return null;
    return resolveVisibleMachinesForActiveServerFromState(state).find((machine) => machine.id === machineId) ?? null;
}
