import { describe, expect, it } from 'vitest';

import type { RuntimeAuthRecoveryIntent } from './RuntimeAuthRecoveryScheduler';
import {
  listMatchingRuntimeAuthRecoveryIntents,
  matchesRuntimeAuthRecoveryIdentity,
} from './matchRuntimeAuthRecoveryIntent';

function intent(input: Readonly<{
  sessionId?: string;
  serviceId: 'claude-subscription' | 'openai-codex';
  groupId: string | null;
  profileId: string | null;
}>): RuntimeAuthRecoveryIntent {
  return {
    v: 1,
    sessionId: input.sessionId ?? 'session-1',
    serviceId: input.serviceId,
    profileId: input.profileId,
    groupId: input.groupId,
    status: 'waiting',
    armedAtMs: 1_000,
    nextRetryAtMs: 2_000,
    attemptCount: 0,
    maxAttempts: 5,
    switchesThisTurn: 0,
    classification: {
      kind: 'auth_expired',
      serviceId: input.serviceId,
      profileId: input.profileId,
      groupId: input.groupId,
      resetsAtMs: null,
      planType: null,
      rateLimits: null,
      source: 'structured_provider_error',
    },
    failurePhase: 'handler',
    failureReason: 'auth_expired',
    lastError: 'auth failed',
    lastErrorClassification: null,
    terminalAtMs: null,
    terminalReason: null,
  };
}

describe('matchRuntimeAuthRecoveryIntent', () => {
  it('matches any pending group-member recovery for the same group identity', () => {
    expect(matchesRuntimeAuthRecoveryIdentity(
      intent({
        serviceId: 'claude-subscription',
        groupId: 'claude',
        profileId: 'broken-member',
      }),
      {
        serviceId: 'claude-subscription',
        groupId: 'claude',
        profileId: 'healthy-member',
      },
    )).toBe(true);
  });

  it('requires exact profile identity for direct-profile recoveries', () => {
    expect(matchesRuntimeAuthRecoveryIdentity(
      intent({
        serviceId: 'claude-subscription',
        groupId: null,
        profileId: 'primary',
      }),
      {
        serviceId: 'claude-subscription',
        groupId: null,
        profileId: 'backup',
      },
    )).toBe(false);
  });

  it('lists only matching intents for a selection identity', () => {
    const intents = [
      intent({
        sessionId: 'session-1',
        serviceId: 'claude-subscription',
        groupId: 'claude',
        profileId: 'broken-member',
      }),
      intent({
        sessionId: 'session-1',
        serviceId: 'claude-subscription',
        groupId: null,
        profileId: 'direct-profile',
      }),
      intent({
        sessionId: 'session-1',
        serviceId: 'openai-codex',
        groupId: 'codex',
        profileId: 'codex3',
      }),
    ];

    expect(listMatchingRuntimeAuthRecoveryIntents(intents, {
      serviceId: 'claude-subscription',
      groupId: 'claude',
      profileId: 'healthy-member',
    })).toEqual([intents[0]]);
  });
});
