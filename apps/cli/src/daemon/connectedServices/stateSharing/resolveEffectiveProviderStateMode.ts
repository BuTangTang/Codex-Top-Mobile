import type { ConnectedServicesProviderStateSharingModeV1 } from '@happier-dev/protocol';

import type { ConnectedServiceStateSharingDescriptor } from '@/backends/types';

/**
 * Clamp the REQUESTED state-sharing mode to the provider-EFFECTIVE mode.
 *
 * The account-level policy (`defaults.stateMode`, default `shared`) applies to
 * every agent, but providers whose descriptor reports `state.supported: false`
 * ignore `shared` and stay isolated (documented contract on
 * `ConnectedServicesProviderStateSharingPolicyV1Schema`). Spawn-gate enrollment
 * must key off this effective mode: enrolling a provider with no real
 * reachability verifier in the hard resume gate fails every connected resume
 * closed (RD-OPI-3).
 */
export function resolveEffectiveProviderStateMode(input: Readonly<{
  requestedStateMode: ConnectedServicesProviderStateSharingModeV1;
  descriptor: ConnectedServiceStateSharingDescriptor | null;
}>): ConnectedServicesProviderStateSharingModeV1 {
  if (input.requestedStateMode !== 'shared') return input.requestedStateMode;
  return input.descriptor?.state.supported === true ? 'shared' : 'isolated';
}
