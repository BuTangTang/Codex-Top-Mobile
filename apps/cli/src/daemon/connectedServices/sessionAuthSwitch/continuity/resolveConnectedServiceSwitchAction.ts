import type {
  ConnectedServiceStateSharingDescriptor,
  ConnectedServiceSwitchContinuityResult,
} from '@/backends/types';

export function resolveConnectedServiceRestartContinuityAction(input: {
  stateSharingDescriptor: ConnectedServiceStateSharingDescriptor;
  restartReason: string;
  sharedStateRequiredReason?: string;
}): ConnectedServiceSwitchContinuityResult {
  if (input.stateSharingDescriptor.state.supported && input.sharedStateRequiredReason) {
    return {
      mode: 'restart_shared_state_required',
      reason: input.sharedStateRequiredReason,
    };
  }

  return {
    mode: 'restart_same_home',
    reason: input.restartReason,
  };
}
