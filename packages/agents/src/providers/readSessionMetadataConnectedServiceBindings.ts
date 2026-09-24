import type { AgentId } from '../types.js';
import type { SessionMetadataConnectedServiceBinding } from '../sessionControls/agentRuntimeDescriptor.js';
import { readCodexSessionMetadataConnectedServiceBindings } from './codex/readSessionMetadataConnectedServiceBindings.js';

type ConnectedServiceBindingReader = (
  metadata: unknown,
) => Readonly<Record<string, SessionMetadataConnectedServiceBinding>>;

const CONNECTED_SERVICE_BINDING_READERS: Partial<Record<AgentId, ConnectedServiceBindingReader>> = {
  codex: readCodexSessionMetadataConnectedServiceBindings,
};

export function readSessionMetadataConnectedServiceBindings(
  metadata: unknown,
  providerId: string,
): Readonly<Record<string, SessionMetadataConnectedServiceBinding>> {
  const reader = CONNECTED_SERVICE_BINDING_READERS[providerId as AgentId];
  return reader ? reader(metadata) : {};
}
