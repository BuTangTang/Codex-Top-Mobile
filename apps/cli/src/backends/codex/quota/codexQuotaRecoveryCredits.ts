import {
  ConnectedServiceQuotaRecoveryCreditsV1Schema,
  type ConnectedServiceQuotaRecoveryCreditKindV1,
  type ConnectedServiceQuotaRecoveryCreditStatusV1,
  type ConnectedServiceQuotaRecoveryCreditV1,
  type ConnectedServiceQuotaRecoveryCreditsV1,
} from '@happier-dev/protocol';

import { parseProviderTimestampMs } from '@/daemon/connectedServices/quotas/normalization';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.trunc(numeric);
}

function normalizeCreditKind(resetType: string | null): ConnectedServiceQuotaRecoveryCreditKindV1 {
  const normalized = resetType?.toLowerCase() ?? '';
  if (normalized.includes('rate_limit') || normalized.includes('rate-limit')) return 'rate_limit_reset';
  if (normalized.includes('usage_limit') || normalized.includes('usage-limit')) return 'usage_limit_reset';
  if (normalized.includes('quota')) return 'quota_reset';
  return 'unknown';
}

function normalizeCreditStatus(value: unknown): ConnectedServiceQuotaRecoveryCreditStatusV1 {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === 'available') return 'available';
  if (normalized === 'redeeming' || normalized === 'redeem_started' || normalized === 'pending') return 'redeeming';
  if (normalized === 'redeemed' || normalized === 'used' || normalized === 'consumed') return 'redeemed';
  if (normalized === 'expired') return 'expired';
  return 'unknown';
}

function readNullableTimestampMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return parseProviderTimestampMs(value);
}

function mapCodexRecoveryCredit(raw: unknown): ConnectedServiceQuotaRecoveryCreditV1 | null {
  const record = isRecord(raw) ? raw : null;
  if (!record) return null;

  const providerResetType = readString(record.reset_type ?? record.resetType);
  const providerCreditId = readString(record.id ?? record.credit_id ?? record.creditId);
  const title = readString(record.title);
  const description = readString(record.description);

  return {
    ...(providerCreditId ? { providerCreditId } : {}),
    kind: normalizeCreditKind(providerResetType),
    status: normalizeCreditStatus(record.status),
    ...(providerResetType ? { providerResetType } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    grantedAtMs: readNullableTimestampMs(record.granted_at ?? record.grantedAt),
    expiresAtMs: readNullableTimestampMs(record.expires_at ?? record.expiresAt),
    redeemStartedAtMs: readNullableTimestampMs(record.redeem_started_at ?? record.redeemStartedAt),
    redeemedAtMs: readNullableTimestampMs(record.redeemed_at ?? record.redeemedAt),
  };
}

function readNextAvailableExpiry(credits: readonly ConnectedServiceQuotaRecoveryCreditV1[]): number | null {
  const expiries = credits
    .filter((credit) => credit.status === 'available')
    .map((credit) => credit.expiresAtMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return expiries.length > 0 ? Math.min(...expiries) : null;
}

export function mapCodexRateLimitResetCreditsToQuotaRecoveryCredits(
  raw: unknown,
): ConnectedServiceQuotaRecoveryCreditsV1 | null {
  const record = isRecord(raw) ? raw : null;
  if (!record) return null;

  const rawCredits = Array.isArray(record.credits) ? record.credits : [];
  const credits = rawCredits
    .map(mapCodexRecoveryCredit)
    .filter((credit): credit is ConnectedServiceQuotaRecoveryCreditV1 => credit !== null);
  const availableCount = readNonNegativeInteger(record.available_count ?? record.availableCount)
    ?? credits.filter((credit) => credit.status === 'available').length;
  const hasCreditsArray = Array.isArray(record.credits);

  if (availableCount === 0 && !hasCreditsArray) return null;

  const totalCount = hasCreditsArray ? credits.length : availableCount;
  const nextExpiresAtMs = readNextAvailableExpiry(credits);

  return ConnectedServiceQuotaRecoveryCreditsV1Schema.parse({
    kind: 'usage_limit_resets',
    availableCount,
    totalCount: Math.max(totalCount, availableCount),
    ...(nextExpiresAtMs !== null ? { nextExpiresAtMs } : {}),
    source: 'provider_api',
    confidence: hasCreditsArray ? 'exact' : 'derived',
    credits,
  });
}
