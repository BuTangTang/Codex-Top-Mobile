import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

export type ConnectedServiceOauthCredentialRecord = ConnectedServiceCredentialRecordV1 & { kind: 'oauth' };
export type ConnectedServiceOauthCredentialRecordWithExpiry = ConnectedServiceOauthCredentialRecord & { expiresAt: number };
export type ConnectedServiceTokenCredentialRecord = ConnectedServiceCredentialRecordV1 & { kind: 'token' };

export function requireConnectedServiceOauthCredentialRecord(
  record: ConnectedServiceCredentialRecordV1,
): ConnectedServiceOauthCredentialRecord {
  if (record.kind !== 'oauth') {
    throw new Error(`Expected oauth credential record for ${record.serviceId}/${record.profileId}`);
  }
  return record;
}

export function requireConnectedServiceOauthCredentialRecordWithExpiry(
  record: ConnectedServiceCredentialRecordV1,
): ConnectedServiceOauthCredentialRecordWithExpiry {
  const oauth = requireConnectedServiceOauthCredentialRecord(record);
  if (typeof oauth.expiresAt !== 'number') {
    throw new Error(`Expected oauth credential record with expiresAt for ${oauth.serviceId}/${oauth.profileId}`);
  }
  return oauth as ConnectedServiceOauthCredentialRecordWithExpiry;
}

export function requireConnectedServiceTokenCredentialRecord(
  record: ConnectedServiceCredentialRecordV1,
): ConnectedServiceTokenCredentialRecord {
  if (record.kind !== 'token') {
    throw new Error(`Expected token credential record for ${record.serviceId}/${record.profileId}`);
  }
  return record;
}

/**
 * RESIDUAL RISK (dual-refresher rotation race, RD-CDX-7 analogue — accepted, recorded here):
 * this entry embeds the OAuth REFRESH token into provider-materialized auth (Pi `auth.json`,
 * OpenCode `OPENCODE_AUTH_CONTENT`; Gemini's `oauth_creds.json` embeds it independently), so
 * provider runtimes can and do self-refresh (Pi even watches `auth.json` mtime and restarts).
 * The daemon refresher is NOT the only writer: daemon-side refresh flows must tolerate the
 * provider rotating the same refresh token concurrently (e.g. treat invalid_grant after a
 * provider-side rotation as re-resolvable, never as immediate profile invalidation).
 */
export function buildConnectedServiceOauthAuthEntry(record: ConnectedServiceOauthCredentialRecordWithExpiry): Record<string, unknown> {
  return {
    type: 'oauth',
    refresh: record.oauth.refreshToken,
    access: record.oauth.accessToken,
    expires: record.expiresAt,
    ...(record.oauth.providerAccountId ? { accountId: record.oauth.providerAccountId } : {}),
  };
}
