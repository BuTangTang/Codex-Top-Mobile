import type {
  ConnectedServiceSwitchDeferralQueue,
  ConnectedServiceSwitchTarget,
} from './connectedServiceSwitchDeferralQueue';

export type ConnectedServiceBeforeTurnDeferredSwitchResult = Readonly<{
  status: 'deferred';
  policy: 'defer_until_turn_boundary';
  reason: 'turn_in_flight';
}>;

export async function requestConnectedServiceSwitchBeforeTurnWithDeferral<T>(input: Readonly<{
  deferralQueue: ConnectedServiceSwitchDeferralQueue;
  sessionId: string;
  source: 'manual' | 'automatic';
  policy: 'defer_until_turn_boundary';
  target: ConnectedServiceSwitchTarget;
  runSwitch: () => Promise<T>;
  onDeferredSwitchFailure?: (error: unknown) => void;
}>): Promise<T | ConnectedServiceBeforeTurnDeferredSwitchResult> {
  if (!input.deferralQueue.isTurnInFlight(input.sessionId)) {
    return await input.runSwitch();
  }

  void input.deferralQueue.requestSwitch({
    sessionId: input.sessionId,
    source: input.source,
    policy: input.policy,
    target: input.target,
    runSwitch: async () => {
      await input.runSwitch();
    },
  }).catch((error) => {
    input.onDeferredSwitchFailure?.(error);
  });

  return {
    status: 'deferred',
    policy: input.policy,
    reason: 'turn_in_flight',
  };
}
