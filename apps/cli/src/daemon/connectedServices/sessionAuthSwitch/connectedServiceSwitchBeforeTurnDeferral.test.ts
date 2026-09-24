import { describe, expect, it, vi } from 'vitest';

import {
  createConnectedServiceSwitchDeferralQueue,
} from './connectedServiceSwitchDeferralQueue';
import {
  requestConnectedServiceSwitchBeforeTurnWithDeferral,
} from './connectedServiceSwitchBeforeTurnDeferral';

describe('requestConnectedServiceSwitchBeforeTurnWithDeferral', () => {
  it('queues an explicit deferral-policy switch until the next turn boundary', async () => {
    const queue = createConnectedServiceSwitchDeferralQueue({
      timeoutMs: 60_000,
      disableDeferral: false,
    });
    const runSwitch = vi.fn(async () => ({ status: 'switched' as const }));
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'prompt_or_steer' });

    await expect(requestConnectedServiceSwitchBeforeTurnWithDeferral({
      deferralQueue: queue,
      sessionId: 'sess_1',
      source: 'automatic',
      policy: 'defer_until_turn_boundary',
      target: {
        serviceId: 'anthropic',
        profileId: 'primary',
        groupId: 'main',
        generation: 0,
      },
      runSwitch,
    })).resolves.toEqual({
      status: 'deferred',
      policy: 'defer_until_turn_boundary',
      reason: 'turn_in_flight',
    });

    expect(runSwitch).not.toHaveBeenCalled();

    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'assistant_message_end' });
    await vi.waitFor(() => {
      expect(runSwitch).toHaveBeenCalledTimes(1);
    });
  });
});
