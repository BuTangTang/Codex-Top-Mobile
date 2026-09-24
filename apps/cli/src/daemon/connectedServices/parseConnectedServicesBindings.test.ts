import { describe, expect, it } from 'vitest';

import {
  parseConnectedServiceBindingSelections,
  parseConnectedServicesBindings,
} from './parseConnectedServicesBindings';

describe('parseConnectedServicesBindings', () => {
  it('returns connected bindings with profile ids', () => {
    const parsed = parseConnectedServicesBindings({
      v: 1,
      bindingsByServiceId: {
        'openai-codex': { source: 'connected', profileId: 'work' },
        anthropic: { source: 'native' },
      },
    });
    expect(parsed).toEqual([{ serviceId: 'openai-codex', profileId: 'work' }]);
  });

  it('keeps profile-only bindings backward compatible through the selection parser', () => {
    const parsed = parseConnectedServiceBindingSelections({
      v: 1,
      bindingsByServiceId: {
        'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
      },
    });

    expect(parsed).toEqual([
      {
        kind: 'profile',
        serviceId: 'openai-codex',
        profileId: 'work',
      },
    ]);
  });

  it('returns group selections with the required fallback profile id', () => {
    const parsed = parseConnectedServiceBindingSelections({
      v: 1,
      bindingsByServiceId: {
        'openai-codex': {
          source: 'connected',
          selection: 'group',
          groupId: 'main',
          profileId: 'fallback',
        },
      },
    });

    expect(parsed).toEqual([
      {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
        fallbackProfileId: 'fallback',
      },
    ]);
  });

  it('returns group selections without fallback profile ids', () => {
    const parsed = parseConnectedServiceBindingSelections({
      v: 1,
      bindingsByServiceId: {
        'openai-codex': {
          source: 'connected',
          selection: 'group',
          groupId: 'main',
        },
      },
    });

    expect(parsed).toEqual([
      {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
      },
    ]);
  });

  it('keeps legacy profile-pair parsing profile-only when a group has no resolved profile yet', () => {
    const parsed = parseConnectedServicesBindings({
      v: 1,
      bindingsByServiceId: {
        'openai-codex': {
          source: 'connected',
          selection: 'group',
          groupId: 'main',
        },
      },
    });

    expect(parsed).toEqual([]);
  });

  it('rejects group selections with protocol-invalid group ids', () => {
    const parsed = parseConnectedServiceBindingSelections({
      v: 1,
      bindingsByServiceId: {
        'openai-codex': {
          source: 'connected',
          selection: 'group',
          groupId: '../global-codex-home',
          profileId: 'work',
        },
      },
    });

    expect(parsed).toEqual([]);
  });

  it('returns an empty list for invalid payloads', () => {
    expect(parseConnectedServicesBindings(null)).toEqual([]);
    expect(parseConnectedServicesBindings({})).toEqual([]);
  });
});
