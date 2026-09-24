import type { ConnectedServiceStateSharingDescriptor } from '@/backends/types';

export const openCodeConnectedServiceStateSharingDescriptor = {
  providerId: 'opencode',
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
    mode: 'process_env',
    // OpenCode auth is delivered ONLY via the process env (`materializeOpenCodeConnectedServiceAuth`);
    // no auth.json file is ever materialized for connected selections.
    secretEntries: ['OPENCODE_AUTH_CONTENT'],
  },
} satisfies ConnectedServiceStateSharingDescriptor;
