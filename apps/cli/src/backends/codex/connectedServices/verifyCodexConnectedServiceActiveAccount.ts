import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

import { classifyDaemonServerWorkError } from '@/daemon/serverWork/classifyDaemonServerWorkError';
import type {
  ConnectedServiceAccountTransitionVerificationResult,
} from '@/daemon/connectedServices/accountTransitions/connectedServiceAccountTransition';
import type { ConnectedServiceRuntimeAuthTargetInput } from '@/daemon/connectedServices/runtimeAuth/types';
import { readCodexLiveAccountIdentity } from './codexLiveAccountIdentity';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readCredentialRecord(input: ConnectedServiceRuntimeAuthTargetInput): ConnectedServiceCredentialRecordV1 | null {
  const selection = readRecord(input.selection);
  const record = readRecord(selection?.record);
  return record as ConnectedServiceCredentialRecordV1 | null;
}

function readClient(value: unknown): { request(method: string, params?: unknown): Promise<unknown> } | null {
  const record = readRecord(value);
  return record && typeof record.request === 'function'
    ? { request: record.request as (method: string, params?: unknown) => Promise<unknown> }
    : null;
}

type CodexAuthStoreProviderAccountIdProof =
  | Readonly<{ status: 'resolved'; accountId: string }>
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'conflict'; accountIds: readonly string[] }>;

function readAuthStoreProviderAccountIdProof(value: unknown): CodexAuthStoreProviderAccountIdProof {
  const accountId = readString(value);
  if (accountId) return { status: 'resolved', accountId };
  const record = readRecord(value);
  if (!record) return { status: 'missing' };
  if (readString(record.status) === 'resolved') {
    const resolvedAccountId = readString(record.accountId);
    return resolvedAccountId ? { status: 'resolved', accountId: resolvedAccountId } : { status: 'missing' };
  }
  if (readString(record.status) === 'conflict') {
    const accountIds = Array.isArray(record.accountIds)
      ? record.accountIds.flatMap((entry) => {
          const parsed = readString(entry);
          return parsed ? [parsed] : [];
        })
      : [];
    return {
      status: 'conflict',
      accountIds,
    };
  }
  return { status: 'missing' };
}

function readAuthStoreProviderAccountIdReader(value: unknown): (() => Promise<CodexAuthStoreProviderAccountIdProof>) | null {
  const record = readRecord(value);
  const reader = record?.readAuthStoreProviderAccountId;
  return typeof reader === 'function'
    ? async () => readAuthStoreProviderAccountIdProof(await reader())
    : null;
}

export function readCodexActiveProviderAccountId(value: unknown): string | null {
  return readCodexLiveAccountIdentity(value).activeAccountId;
}

export async function verifyCodexConnectedServiceActiveAccount(
  input: ConnectedServiceRuntimeAuthTargetInput,
): Promise<ConnectedServiceAccountTransitionVerificationResult> {
  const selection = readRecord(input.selection);
  const record = readCredentialRecord(input);
  if (!record || record.kind !== 'oauth' || record.serviceId !== 'openai-codex') {
    return {
      status: 'unavailable',
      retryable: false,
      reason: 'missing_expected_provider_account_id',
    };
  }
  const expectedProviderAccountId = readString(record.oauth.providerAccountId);
  if (!expectedProviderAccountId) {
    return {
      status: 'unavailable',
      retryable: false,
      reason: 'missing_expected_provider_account_id',
    };
  }

  const client = readClient(selection?.client);
  if (!client) {
    return {
      status: 'unavailable',
      retryable: true,
      reason: 'active_account_probe_client_unavailable',
    };
  }

  let rawAccount: unknown;
  try {
    rawAccount = await client.request('account/read', {});
  } catch (error) {
    const classification = classifyDaemonServerWorkError(error);
    return {
      status: 'unavailable',
      retryable: classification.retryable,
      reason: 'active_account_probe_failed',
      errorClassification: classification,
    };
  }

  const actualProviderAccountId = readCodexActiveProviderAccountId(rawAccount);
  if (!actualProviderAccountId) {
    const readAuthStoreProviderAccountId = readAuthStoreProviderAccountIdReader(selection);
    const authStoreProviderAccountIdProof = readAuthStoreProviderAccountId
      ? await readAuthStoreProviderAccountId()
      : { status: 'missing' as const };
    if (authStoreProviderAccountIdProof.status === 'conflict') {
      return {
        status: 'mismatch',
        expectedProviderAccountId,
        actualProviderAccountId: authStoreProviderAccountIdProof.accountIds
          .find((accountId) => accountId !== expectedProviderAccountId) ?? null,
        retryable: true,
        reason: 'provider_account_auth_store_conflict',
      };
    }
    if (authStoreProviderAccountIdProof.status === 'resolved') {
      const authStoreProviderAccountId = authStoreProviderAccountIdProof.accountId;
      if (authStoreProviderAccountId !== expectedProviderAccountId) {
        return {
          status: 'mismatch',
          expectedProviderAccountId,
          actualProviderAccountId: authStoreProviderAccountId,
          retryable: true,
          reason: 'provider_account_auth_store_mismatch',
        };
      }
    }
    // Auth-store proof can diagnose exact mismatches. Email from account/read is
    // diagnostic label evidence only and cannot prove or disprove Codex account id.
    return {
      status: 'unavailable',
      retryable: true,
      reason: 'active_account_probe_missing_account_id',
    };
  }

  if (actualProviderAccountId !== expectedProviderAccountId) {
    return {
      status: 'mismatch',
      expectedProviderAccountId,
      actualProviderAccountId,
      retryable: true,
      reason: 'provider_account_adoption_mismatch',
    };
  }

  return {
    status: 'verified',
    providerAccountId: actualProviderAccountId,
  };
}
