import {
  ConnectedServiceIdSchema,
  type ConnectedServiceId,
  type SessionRuntimeIssueV1,
  type SessionUsageLimitRecoveryV1,
} from '@happier-dev/protocol';

function readConnectedServiceId(value: unknown): ConnectedServiceId | null {
  const parsed = ConnectedServiceIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

export function resolveUsageLimitRecoverySelectedAuthFromIssue(input: Readonly<{
  issue: SessionRuntimeIssueV1;
  defaultNativeServiceId?: ConnectedServiceId | null;
  requiredConnectedServiceId?: ConnectedServiceId | null;
}>): SessionUsageLimitRecoveryV1['selectedAuth'] | null {
  const connectedService = input.issue.usageLimit?.connectedService;
  const connectedServiceId = readConnectedServiceId(connectedService?.serviceId);
  if (input.requiredConnectedServiceId && connectedServiceId !== input.requiredConnectedServiceId) {
    return null;
  }

  const serviceId = connectedServiceId ?? input.defaultNativeServiceId ?? null;
  const groupId = readString(connectedService?.groupId);
  const profileId = readString(connectedService?.profileId);
  if (groupId && serviceId) {
    return {
      kind: 'group',
      serviceId,
      groupId,
      profileId,
    };
  }
  if (profileId && serviceId) {
    return {
      kind: 'profile',
      serviceId,
      profileId,
    };
  }
  return serviceId ? { kind: 'native', serviceId } : { kind: 'native' };
}
