import { describe, expect, it } from 'vitest';

import type { ConnectedServiceStateSharingDescriptor } from '@/backends/types';

import { resolveEffectiveProviderStateMode } from './resolveEffectiveProviderStateMode';

function buildDescriptor(input: Readonly<{ stateSupported: boolean }>): ConnectedServiceStateSharingDescriptor {
  return {
    providerId: 'claude',
    providerSupportStatus: input.stateSupported ? 'supported' : 'unsupported',
    config: {
      supported: input.stateSupported,
      modes: input.stateSupported ? ['linked', 'copied', 'isolated'] : ['isolated'],
      entries: [],
      ...(input.stateSupported ? {} : { unavailableReason: 'not_implemented' as const }),
    },
    state: {
      supported: input.stateSupported,
      modes: input.stateSupported ? ['isolated', 'shared'] : ['isolated'],
      entries: [],
      symlinkUnavailableDegradePolicy: 'block_continuity',
      ...(input.stateSupported ? {} : { unavailableReason: 'not_implemented' as const }),
    },
    authIsolation: {
      mode: 'materialized_home',
      secretEntries: [],
    },
  };
}

describe('resolveEffectiveProviderStateMode', () => {
  it('keeps a requested shared mode when the provider descriptor supports shared state', () => {
    expect(resolveEffectiveProviderStateMode({
      requestedStateMode: 'shared',
      descriptor: buildDescriptor({ stateSupported: true }),
    })).toBe('shared');
  });

  it('clamps a requested shared mode to isolated when the descriptor does not support shared state (RD-OPI-3)', () => {
    // Gemini/OpenCode shape: the global `defaults.stateMode: 'shared'` setting
    // applies to every agent, but their reachability verifiers are always-false.
    // Enrolling them in the hard spawn gate bricks every connected resume.
    expect(resolveEffectiveProviderStateMode({
      requestedStateMode: 'shared',
      descriptor: buildDescriptor({ stateSupported: false }),
    })).toBe('isolated');
  });

  it('clamps a requested shared mode to isolated when the provider declares no descriptor', () => {
    expect(resolveEffectiveProviderStateMode({
      requestedStateMode: 'shared',
      descriptor: null,
    })).toBe('isolated');
  });

  it('never widens an isolated request', () => {
    expect(resolveEffectiveProviderStateMode({
      requestedStateMode: 'isolated',
      descriptor: buildDescriptor({ stateSupported: true }),
    })).toBe('isolated');
  });
});
