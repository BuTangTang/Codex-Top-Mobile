import { describe, expect, it, vi } from 'vitest';

import type { ConnectedServiceBindingsV1 } from '@happier-dev/protocol';
import { resolveManualSwitchPreviousGroupMembers } from './resolveManualSwitchPreviousGroupMembers';

describe('resolveManualSwitchPreviousGroupMembers', () => {
  it('resolves the live active member for a group-bound service', async () => {
    const getConnectedServiceAuthGroup = vi.fn(async ({ groupId }: { groupId: string }) =>
      groupId === 'happier' ? { activeProfileId: 'codex1' } : null);

    const result = await resolveManualSwitchPreviousGroupMembers({
      api: { getConnectedServiceAuthGroup },
      previousBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'group', groupId: 'happier' },
        },
      } as ConnectedServiceBindingsV1,
    });

    expect(result.get('openai-codex')).toBe('codex1');
    expect(getConnectedServiceAuthGroup).toHaveBeenCalledWith({ serviceId: 'openai-codex', groupId: 'happier' });
  });

  it('skips native/profile bindings (no group lookup) and groups with no active member', async () => {
    const getConnectedServiceAuthGroup = vi.fn(async () => null);

    const result = await resolveManualSwitchPreviousGroupMembers({
      api: { getConnectedServiceAuthGroup },
      previousBindings: {
        v: 1,
        bindingsByServiceId: {
          anthropic: { source: 'native' },
          openai: { source: 'connected', selection: 'profile', profileId: 'work' },
          'openai-codex': { source: 'connected', selection: 'group', groupId: 'gone' },
        },
      } as ConnectedServiceBindingsV1,
    });

    expect(result.size).toBe(0);
    // Only the group binding triggers a lookup; native/profile are skipped.
    expect(getConnectedServiceAuthGroup).toHaveBeenCalledTimes(1);
    expect(getConnectedServiceAuthGroup).toHaveBeenCalledWith({ serviceId: 'openai-codex', groupId: 'gone' });
  });

  it('is resilient to lookup failures (omits the service, no throw)', async () => {
    const getConnectedServiceAuthGroup = vi.fn(async () => {
      throw new Error('network');
    });

    const result = await resolveManualSwitchPreviousGroupMembers({
      api: { getConnectedServiceAuthGroup },
      previousBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'group', groupId: 'happier' },
        },
      } as ConnectedServiceBindingsV1,
    });

    expect(result.size).toBe(0);
  });
});
