import type { SessionMachineControlTarget } from '@/sync/ops/sessionMachineTarget';

export type SessionResumeMachineTarget = Readonly<{
    machineId: string;
    directory: string;
}>;

function normalizeNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function resolveSessionResumeMachineTarget(
    controlTarget: SessionMachineControlTarget | null | undefined,
): SessionResumeMachineTarget | null {
    const machineId = normalizeNonEmptyString(controlTarget?.machineId);
    const directory = normalizeNonEmptyString(controlTarget?.basePath);
    if (!machineId || !directory) return null;
    return { machineId, directory };
}
