import type { SessionMetadataConnectedServiceBinding } from '../../sessionControls/agentRuntimeDescriptor.js';
import { readSessionMetadataRuntimeDescriptor } from '../../sessionControls/agentRuntimeDescriptor.js';

export function readCodexSessionMetadataConnectedServiceBindings(
  metadata: unknown,
): Readonly<Record<string, SessionMetadataConnectedServiceBinding>> {
  const descriptor = readSessionMetadataRuntimeDescriptor(metadata, 'codex');
  if (descriptor?.home !== 'connectedService' || !descriptor.connectedServiceId) return {};

  if (descriptor.connectedServiceGroupId) {
    return {
      [descriptor.connectedServiceId]: {
        source: 'connected',
        selection: 'group',
        groupId: descriptor.connectedServiceGroupId,
        ...(descriptor.connectedServiceProfileId ? { profileId: descriptor.connectedServiceProfileId } : {}),
      },
    };
  }

  if (!descriptor.connectedServiceProfileId) return {};
  return {
    [descriptor.connectedServiceId]: {
      source: 'connected',
      selection: 'profile',
      profileId: descriptor.connectedServiceProfileId,
    },
  };
}
