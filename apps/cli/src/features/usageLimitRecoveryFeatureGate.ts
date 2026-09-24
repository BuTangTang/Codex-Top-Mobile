import {
  SessionUsageLimitRecoveryOperationResultV1Schema,
  type SessionUsageLimitRecoveryOperationResultV1,
} from '@happier-dev/protocol';

import { resolveCliFeatureDecisionForServer } from './featureDecisionService';
import { resolveServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';

const SESSION_USAGE_LIMIT_RECOVERY_FEATURE_GATE_TIMEOUT_MS = 800;

export function usageLimitRecoveryFeatureDisabledResult(params: Readonly<{
  sessionId?: string | null;
}> = {}): SessionUsageLimitRecoveryOperationResultV1 {
  return SessionUsageLimitRecoveryOperationResultV1Schema.parse({
    ok: false,
    status: 'unsupported',
    ...(typeof params.sessionId === 'string' && params.sessionId.trim().length > 0
      ? { sessionId: params.sessionId }
      : {}),
    errorCode: 'feature_disabled',
  });
}

export async function resolveUsageLimitRecoveryFeatureEnabled(params: Readonly<{
  env?: NodeJS.ProcessEnv;
  serverUrl?: string;
  timeoutMs?: number;
}> = {}): Promise<boolean> {
  const resolved = await resolveCliFeatureDecisionForServer({
    featureId: 'sessions.usageLimitRecovery',
    env: params.env ?? process.env,
    serverUrl: params.serverUrl ?? resolveServerHttpBaseUrl(),
    timeoutMs: params.timeoutMs ?? SESSION_USAGE_LIMIT_RECOVERY_FEATURE_GATE_TIMEOUT_MS,
  });

  return resolved.decision.state === 'enabled';
}
