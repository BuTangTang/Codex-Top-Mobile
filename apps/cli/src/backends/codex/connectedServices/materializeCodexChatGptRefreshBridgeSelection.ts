import type {
  AccountSettings,
  ConnectedServiceCredentialRecordV1,
  ConnectedServiceId,
} from '@happier-dev/protocol';

import {
  materializeConnectedServicesForSpawn,
  type ConnectedServiceResolvedSelection,
} from '@/daemon/connectedServices/materialize/materializeConnectedServicesForSpawn';

import {
  resolveCodexChatGptAuthTokensRefreshProfileId,
  type CodexChatGptAuthTokensRefreshSelection,
} from './codexChatGptAuthTokensRefreshBridgeContract';

export async function materializeCodexChatGptRefreshBridgeSelection(params: Readonly<{
  selection: CodexChatGptAuthTokensRefreshSelection;
  record: ConnectedServiceCredentialRecordV1;
  activeServerDir: string;
  baseDir: string;
  accountSettings: AccountSettings | Readonly<Record<string, unknown>> | null | undefined;
  processEnv?: NodeJS.ProcessEnv;
}>): Promise<void> {
  const recordsByServiceId = new Map<ConnectedServiceId, ConnectedServiceCredentialRecordV1>([
    ['openai-codex', params.record],
  ]);
  const selectionsByServiceId = new Map<ConnectedServiceId, ConnectedServiceResolvedSelection>();

  if (params.selection.kind === 'group') {
    selectionsByServiceId.set('openai-codex', {
      kind: 'group',
      serviceId: 'openai-codex',
      groupId: params.selection.groupId,
      activeProfileId: params.selection.activeProfileId,
      fallbackProfileId: params.selection.fallbackProfileId,
      generation: params.selection.generation,
      record: params.record,
      policy: null,
    });
  } else {
    selectionsByServiceId.set('openai-codex', {
      kind: 'profile',
      serviceId: 'openai-codex',
      profileId: params.selection.profileId,
      record: params.record,
    });
  }

  await materializeConnectedServicesForSpawn({
    agentId: 'codex',
    materializationKey: `openai-codex-refresh-${resolveCodexChatGptAuthTokensRefreshProfileId(params.selection)}`,
    activeServerDir: params.activeServerDir,
    baseDir: params.baseDir,
    recordsByServiceId,
    selectionsByServiceId,
    accountSettings: params.accountSettings ?? null,
    processEnv: params.processEnv ?? process.env,
  });
}
