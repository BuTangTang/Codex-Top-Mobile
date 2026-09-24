import type { AgentState } from '../types';
import { resolveAgentRequestKind } from '@/agent/permissions/requestKind';
import {
  CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE,
  CLAUDE_LOCAL_PERMISSION_BRIDGE_STOPPED_REASON,
  isAgentStateRequestCoveredByCompletedRequests,
} from '@happier-dev/agents';

type ActivitySummary = Readonly<{
  pendingPermissionRequestCount: number;
  pendingUserActionRequestCount: number;
}>;

const PENDING_REQUEST_COVERAGE_OPTIONS = {
  equivalentSources: [CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE],
  equivalentCompletedStatuses: ['canceled'],
  equivalentCompletedReasons: [CLAUDE_LOCAL_PERMISSION_BRIDGE_STOPPED_REASON],
} as const;

export function deriveActivitySummaryFromAgentState(agentState: AgentState | null | undefined): ActivitySummary {
  const requests = agentState?.requests;
  const completedRequests = agentState?.completedRequests ?? null;
  if (!requests || typeof requests !== 'object') {
    return {
      pendingPermissionRequestCount: 0,
      pendingUserActionRequestCount: 0,
    };
  }

  let pendingPermissionRequestCount = 0;
  let pendingUserActionRequestCount = 0;

  for (const [requestId, request] of Object.entries(requests)) {
    if (!request || typeof request !== 'object') continue;
    const toolName = typeof request.tool === 'string' ? request.tool : '';
    if (!toolName) continue;
    if (isAgentStateRequestCoveredByCompletedRequests({
      requestId,
      request,
      completedRequests: completedRequests as Record<string, unknown> | null | undefined,
      options: PENDING_REQUEST_COVERAGE_OPTIONS,
    })) continue;

    const kind = request.kind === 'user_action' || request.kind === 'permission'
      ? request.kind
      : resolveAgentRequestKind(toolName);

    if (kind === 'user_action') {
      pendingUserActionRequestCount += 1;
    } else {
      pendingPermissionRequestCount += 1;
    }
  }

  return {
    pendingPermissionRequestCount,
    pendingUserActionRequestCount,
  };
}
