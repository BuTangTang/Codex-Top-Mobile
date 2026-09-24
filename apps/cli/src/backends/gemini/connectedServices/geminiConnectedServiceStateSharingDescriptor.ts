import type { ConnectedServiceStateSharingDescriptor } from '@/backends/types';

export const geminiConnectedServiceStateSharingDescriptor = {
  providerId: 'gemini',
  providerSupportStatus: 'unsupported',
  config: {
    supported: false,
    modes: ['isolated'],
    entries: [],
    unavailableReason: 'not_implemented',
  },
  state: {
    supported: false,
    modes: ['isolated'],
    entries: [],
    symlinkUnavailableDegradePolicy: 'block_continuity',
    unavailableReason: 'not_implemented',
  },
  authIsolation: {
    mode: 'materialized_home',
    secretEntries: [
      '.gemini/oauth_creds.json',
    ],
  },
} satisfies ConnectedServiceStateSharingDescriptor;
