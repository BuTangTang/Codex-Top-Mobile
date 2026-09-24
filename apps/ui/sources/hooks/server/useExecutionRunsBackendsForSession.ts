import * as React from 'react';

import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { useMachineCapabilitiesCache } from '@/hooks/server/useMachineCapabilitiesCache';
import { resolveSessionMachineId } from '@/sync/domains/session/directSessions/resolveSessionMachineId';
import { useSession } from '@/sync/domains/state/storage';
import { extractExecutionRunsBackendsFromMachineCapabilitiesState } from '@/sync/domains/executionRuns/extractExecutionRunsBackendsFromMachineCapabilities';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';

export function useExecutionRunsBackendsForSession(
  sessionId: string,
  preferredServerIdOverride?: string | null,
): Record<string, any> | null {
  const session = useSession(sessionId);
  const machineTarget = useSessionMachineTarget(sessionId);
  const machineId = machineTarget?.machineId ?? resolveSessionMachineId((session as any)?.metadata);
  const resolvedServerId = usePreferredServerIdForSession(sessionId);
  const serverId = preferredServerIdOverride ?? resolvedServerId;

  const machineCapabilities = useMachineCapabilitiesCache({
    machineId,
    ...(serverId ? { serverId } : {}),
    enabled: Boolean(machineId),
    request: { requests: [{ id: 'tool.executionRuns' }] } as any,
  });

  return React.useMemo(() => extractExecutionRunsBackendsFromMachineCapabilitiesState(machineCapabilities.state), [machineCapabilities.state]);
}
