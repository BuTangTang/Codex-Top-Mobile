import { describe, expect, it } from 'vitest';

import { resolveConnectedServiceNotificationProfileLabel } from './connectedServiceNotificationLabels';

describe('connectedServiceNotificationLabels', () => {
  it('does not use raw provider account ids as public profile labels', () => {
    const profilesById = new Map([
      ['primary', {
        profileId: 'primary',
        status: 'connected' as const,
        providerEmail: null,
        providerAccountId: 'acct-provider-opaque-secret',
      }],
    ]);

    expect(resolveConnectedServiceNotificationProfileLabel(profilesById, 'primary')).toBe('primary');
  });
});
