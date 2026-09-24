import {
  ConnectedServiceCredentialRecordV1Schema,
  type ConnectedServiceCredentialRecordV1,
} from '@happier-dev/protocol';

import {
  refreshConnectedAccountOauthTokens,
  type ConnectedAccountOauthRefreshResult,
} from '@/daemon/connectedServices/refresh/serviceRefreshers';
import type { ConnectedServiceRefreshReason } from '@/daemon/connectedServices/credentials/lifecycleTypes';
import { requireConnectedServiceOauthCredentialRecord } from '@/daemon/connectedServices/shared/connectedServiceCredentialRecord';
import type { CodexChatGptAuthTokensRefreshResponse } from './codexChatGptAuthTokensRefreshBridgeContract';

export type CodexChatGptTokensRefreshBridgeResponse = CodexChatGptAuthTokensRefreshResponse;

type RefreshOauthTokens = (params: Readonly<{
  serviceId: 'openai-codex';
  refreshToken: string;
  now: number;
  reason: Extract<ConnectedServiceRefreshReason, 'provider_auth_bridge'>;
}>) => Promise<ConnectedAccountOauthRefreshResult>;

export async function refreshCodexChatGptTokensForBridge(params: Readonly<{
  record: ConnectedServiceCredentialRecordV1;
  chatgptPlanType: string | null;
  now: number;
  refreshOauthTokens?: RefreshOauthTokens;
}>): Promise<Readonly<{
  codexResponse: CodexChatGptAuthTokensRefreshResponse;
  updatedRecord: ConnectedServiceCredentialRecordV1;
}>> {
  const record = requireConnectedServiceOauthCredentialRecord(params.record);
  if (record.serviceId !== 'openai-codex') {
    throw new Error(`Expected openai-codex credential record, got ${record.serviceId}`);
  }
  const refresh = params.refreshOauthTokens ?? refreshConnectedAccountOauthTokens;
  const refreshed = await refresh({
    serviceId: 'openai-codex',
    refreshToken: record.oauth.refreshToken,
    now: params.now,
    reason: 'provider_auth_bridge',
  });
  const updatedRecord = ConnectedServiceCredentialRecordV1Schema.parse({
    ...record,
    updatedAt: Math.max(0, Math.trunc(params.now)),
    expiresAt: refreshed.expiresAt,
    oauth: {
      ...record.oauth,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      idToken: refreshed.idToken,
    },
  });
  return {
    codexResponse: {
      accessToken: refreshed.accessToken,
      chatgptAccountId: record.oauth.providerAccountId,
      chatgptPlanType: params.chatgptPlanType,
    },
    updatedRecord,
  };
}
