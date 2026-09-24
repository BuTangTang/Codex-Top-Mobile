import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';

import type { CodexHotApplyEligibility } from './types';

function normalizeOptionalId(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeLoginMethod(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalId(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function evaluateCodexConnectedServiceHotApplyEligibility(params: Readonly<{
  candidate: ConnectedServiceCredentialRecordV1;
  forcedWorkspaceId: string | null;
  forcedLoginMethod?: string | null;
}>): CodexHotApplyEligibility {
  if (params.candidate.kind !== 'oauth' || params.candidate.serviceId !== 'openai-codex') {
    return {
      eligible: false,
      reason: 'direct_live_hot_auth_ineligible',
      detailReason: 'auth_family_mismatch',
    };
  }

  const forcedLoginMethod = normalizeLoginMethod(params.forcedLoginMethod);
  if (forcedLoginMethod && forcedLoginMethod !== 'chatgpt' && forcedLoginMethod !== 'chatgptauthtokens') {
    return {
      eligible: false,
      reason: 'direct_live_hot_auth_ineligible',
      detailReason: 'credential_family_mismatch',
    };
  }

  const forcedWorkspaceId = normalizeOptionalId(params.forcedWorkspaceId);
  if (forcedWorkspaceId) {
    const candidateAccountId = normalizeOptionalId(params.candidate.oauth.providerAccountId);
    if (candidateAccountId !== forcedWorkspaceId) {
      return { eligible: false, reason: 'forced_workspace_incompatible' };
    }
  }
  return { eligible: true };
}

export function readCodexCredentialProviderAccountId(record: ConnectedServiceCredentialRecordV1): string | null {
  if (record.kind !== 'oauth') return null;
  return normalizeOptionalId(record.oauth.providerAccountId);
}
