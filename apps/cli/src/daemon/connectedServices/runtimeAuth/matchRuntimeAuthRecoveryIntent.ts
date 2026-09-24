import type { ConnectedServiceId } from '@happier-dev/protocol';

import type { RuntimeAuthRecoveryIntent } from './RuntimeAuthRecoveryScheduler';

export type RuntimeAuthRecoverySelectionIdentity = Readonly<{
  serviceId: ConnectedServiceId;
  groupId: string | null;
  profileId: string | null;
}>;

export function matchesRuntimeAuthRecoveryIdentity(
  intent: Pick<RuntimeAuthRecoveryIntent, 'serviceId' | 'groupId' | 'profileId'>,
  identity: RuntimeAuthRecoverySelectionIdentity,
): boolean {
  if (intent.serviceId !== identity.serviceId) return false;
  if (identity.groupId) {
    return intent.groupId === identity.groupId;
  }
  return intent.groupId === null && intent.profileId === identity.profileId;
}

export function listMatchingRuntimeAuthRecoveryIntents(
  intents: ReadonlyArray<RuntimeAuthRecoveryIntent>,
  identity: RuntimeAuthRecoverySelectionIdentity,
): ReadonlyArray<RuntimeAuthRecoveryIntent> {
  return intents.filter((intent) => matchesRuntimeAuthRecoveryIdentity(intent, identity));
}
