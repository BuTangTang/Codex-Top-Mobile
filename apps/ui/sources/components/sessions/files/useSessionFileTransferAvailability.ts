import * as React from 'react';

import { useSessionMachineReachability } from '@/components/sessions/model/useSessionMachineReachability';
import { useServerFeaturesSnapshotForServerId } from '@/sync/domains/features/featureDecisionRuntime';
import { resolveSessionFileTransferRouteAvailability } from '@/sync/domains/transfers/runtime/resolveTransferAvailability';
import { readCachedMachineRpcDirectRoute } from '@/sync/domains/transfers/runtime/transferRouteCache';
import { useSessionRpcAvailabilityState } from '@/sync/domains/state/storage';
import { readMachineTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';

export function useSessionFileTransferAvailabilityResolver(sessionId: string): (transferSizeBytes?: number | null) => boolean {
    const { sessionExists, sessionRpcAvailable } = useSessionRpcAvailabilityState(sessionId);
    const { machineRpcTargetAvailable } = useSessionMachineReachability(sessionId);
    const serverId = resolvePreferredServerIdForSessionId(sessionId) ?? null;
    const serverSnapshot = useServerFeaturesSnapshotForServerId(serverId, {
        enabled: Boolean(serverId) && (sessionRpcAvailable || machineRpcTargetAvailable),
    });

    return React.useCallback((transferSizeBytes?: number | null) => {
        if (!sessionExists) {
            return false;
        }
        if (!serverId) {
            return false;
        }
        if (serverSnapshot.status !== 'ready') {
            return false;
        }

        const machineTarget = readMachineTargetForSession(sessionId);
        const directRouteCache = machineTarget && machineRpcTargetAvailable
            ? readCachedMachineRpcDirectRoute({
                serverId,
                remoteMachineId: machineTarget.machineId,
            })
            : null;
        const directRouteAvailable = Boolean(
            machineTarget
            && machineRpcTargetAvailable
            && (
                directRouteCache?.status === 'viable'
                || (sessionRpcAvailable === false && directRouteCache?.status !== 'unavailable')
            ),
        );

        const sizedBytes = typeof transferSizeBytes === 'number' && Number.isFinite(transferSizeBytes)
            ? Math.max(0, Math.floor(transferSizeBytes))
            : null;

        return resolveSessionFileTransferRouteAvailability({
            serverId,
            machineTargetAvailable: directRouteAvailable,
            sessionRpcAvailable,
            serverFeatures: serverSnapshot.features,
            sessionRpcTransferSizeBytes: sizedBytes,
        }).kind === 'selected';
    }, [
        machineRpcTargetAvailable,
        serverId,
        serverSnapshot,
        sessionExists,
        sessionId,
        sessionRpcAvailable,
    ]);
}

export function useSessionFileTransferAvailability(sessionId: string): boolean {
    const canTransfer = useSessionFileTransferAvailabilityResolver(sessionId);
    return canTransfer(null);
}
