import { join } from 'node:path';

import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

import { requireConnectedServiceOauthCredentialRecord } from '@/daemon/connectedServices/shared/connectedServiceCredentialRecord';
import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';

/**
 * Canonical writer for the Codex auth store (`<codexHome>/auth.json`).
 *
 * Used by full home materialization AND by runtime hot-apply: the session
 * app-server re-reads this file when its transports are invalidated, so any
 * account switch must land here durably to be adopted.
 */
export async function writeCodexAuthStoreFile(params: Readonly<{
  codexHome: string;
  record: ConnectedServiceCredentialRecordV1;
}>): Promise<void> {
  const record = requireConnectedServiceOauthCredentialRecord(params.record);
  const tokens = {
    access_token: record.oauth.accessToken,
    refresh_token: record.oauth.refreshToken,
    id_token: record.oauth.idToken,
    account_id: record.oauth.providerAccountId,
  } as const;
  await writeJsonAtomic(join(params.codexHome, 'auth.json'), {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    ...tokens,
    // Match Codex CLI expectations while keeping our existing flat format for backward compatibility.
    tokens,
    last_refresh: new Date().toISOString(),
  });
}
