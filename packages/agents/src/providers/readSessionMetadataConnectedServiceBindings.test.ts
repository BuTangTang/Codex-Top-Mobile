import { describe, expect, it } from 'vitest';

import { buildCodexAgentRuntimeDescriptor } from '../sessionControls/agentRuntimeDescriptor.js';
import { readSessionMetadataConnectedServiceBindings } from './readSessionMetadataConnectedServiceBindings.js';

describe('readSessionMetadataConnectedServiceBindings', () => {
  it('reads connected-service bindings through provider-owned runtime descriptor readers', () => {
    const descriptor = buildCodexAgentRuntimeDescriptor({
      backendMode: 'appServer',
      vendorSessionId: 'thread_connected',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: 'work',
      connectedServiceGroupId: 'main',
      homePath: '/tmp/codex-home',
    });

    expect(readSessionMetadataConnectedServiceBindings({
      agentRuntimeDescriptorV1: descriptor,
    }, 'codex')).toEqual({
      'openai-codex': {
        source: 'connected',
        selection: 'group',
        groupId: 'main',
        profileId: 'work',
      },
    });
    expect(readSessionMetadataConnectedServiceBindings({
      agentRuntimeDescriptorV1: descriptor,
    }, 'opencode')).toEqual({});
  });
});
