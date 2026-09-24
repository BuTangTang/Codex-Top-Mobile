import { describe, expect, it } from 'vitest';

import type { ConnectedServiceSwitchContinuityParams } from '@/backends/types';

import { resolveOpenCodeConnectedServiceSwitchContinuity } from './resolveOpenCodeConnectedServiceSwitchContinuity';

function createParams(
  overrides: Partial<ConnectedServiceSwitchContinuityParams> = {},
): ConnectedServiceSwitchContinuityParams {
  return {
    sessionId: 'session-1',
    agentId: 'opencode',
    serviceId: 'openai',
    previousBinding: {
      source: 'connected',
      selection: 'profile',
      serviceId: 'openai',
      profileId: 'old',
      groupId: null,
    },
    nextBinding: {
      source: 'connected',
      selection: 'profile',
      serviceId: 'openai',
      profileId: 'new',
      groupId: null,
    },
    fromBindings: {
      v: 1,
      bindingsByServiceId: {
        openai: { source: 'connected', selection: 'profile', profileId: 'old' },
      },
    },
    toBindings: {
      v: 1,
      bindingsByServiceId: {
        openai: { source: 'connected', selection: 'profile', profileId: 'new' },
      },
    },
    ...overrides,
  };
}

describe('resolveOpenCodeConnectedServiceSwitchContinuity', () => {
  it('uses restart/rematerialize continuity for changed connected profile switches', async () => {
    await expect(resolveOpenCodeConnectedServiceSwitchContinuity(createParams({
      connectedServiceMaterializationIdentityV1: {
        v: 1,
        id: 'materialization-1',
        createdAtMs: 1,
      },
      vendorResumeId: 'vendor-session-1',
    }))).resolves.toEqual({
      mode: 'restart_same_home',
      reason: 'opencode_restart_rematerialize_required',
    });
  });

  it('uses restart/rematerialize continuity for native to connected switches', async () => {
    await expect(resolveOpenCodeConnectedServiceSwitchContinuity(createParams({
      previousBinding: {
        source: 'native',
        selection: 'native',
        serviceId: 'openai',
        profileId: null,
        groupId: null,
      },
      fromBindings: {
        v: 1,
        bindingsByServiceId: {
          openai: { source: 'native' },
        },
      },
      connectedServiceMaterializationIdentityV1: {
        v: 1,
        id: 'materialization-1',
        createdAtMs: 1,
      },
      vendorResumeId: 'vendor-session-1',
    }))).resolves.toEqual({
      mode: 'restart_same_home',
      reason: 'opencode_restart_rematerialize_required',
    });
  });

  // OpenCode session state lives in the GLOBAL shared managed-server storage (not home-scoped),
  // so an identical re-selection is at least as resumable as a changed selection. It must route
  // through the same restart/rematerialize action instead of failing closed on a home-scoped
  // reachability proof that can never succeed (RD-OPI-4).
  it('uses restart/rematerialize continuity for exact connected-selection re-selection', async () => {
    await expect(resolveOpenCodeConnectedServiceSwitchContinuity(createParams({
      previousBinding: {
        source: 'connected',
        selection: 'profile',
        serviceId: 'openai',
        profileId: 'same',
        groupId: null,
      },
      nextBinding: {
        source: 'connected',
        selection: 'profile',
        serviceId: 'openai',
        profileId: 'same',
        groupId: null,
      },
      fromBindings: {
        v: 1,
        bindingsByServiceId: {
          openai: { source: 'connected', selection: 'profile', profileId: 'same' },
        },
      },
      toBindings: {
        v: 1,
        bindingsByServiceId: {
          openai: { source: 'connected', selection: 'profile', profileId: 'same' },
        },
      },
      connectedServiceMaterializationIdentityV1: {
        v: 1,
        id: 'materialization-1',
        createdAtMs: 1,
      },
      vendorResumeId: 'vendor-session-1',
    }))).resolves.toEqual({
      mode: 'restart_same_home',
      reason: 'opencode_restart_rematerialize_required',
    });
  });

  it('keeps unsupported services unsupported', async () => {
    await expect(resolveOpenCodeConnectedServiceSwitchContinuity(createParams({
      serviceId: 'gemini',
      previousBinding: {
        source: 'connected',
        selection: 'profile',
        serviceId: 'gemini',
        profileId: 'old',
        groupId: null,
      },
      nextBinding: {
        source: 'connected',
        selection: 'profile',
        serviceId: 'gemini',
        profileId: 'new',
        groupId: null,
      },
    }))).resolves.toEqual({
      mode: 'unsupported',
      reason: 'unsupported_service',
    });
  });
});
