import { parseProviderTimestampMs } from '@/daemon/connectedServices/quotas/normalization';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function unwrapCodexRateLimitSnapshot(rawSnapshot: unknown): unknown {
  const record = isRecord(rawSnapshot) ? rawSnapshot : null;
  if (record && isRecord(record.rateLimits)) return record.rateLimits;
  if (record && isRecord(record.rate_limits)) return record.rate_limits;
  if (record && isRecord(record.rate_limit)) return record.rate_limit;
  return rawSnapshot;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readCodexRateLimitMeter(rawSnapshot: unknown, key: 'primary' | 'secondary'): Record<string, unknown> | null {
  const unwrappedSnapshot = unwrapCodexRateLimitSnapshot(rawSnapshot);
  const snapshot = isRecord(unwrappedSnapshot) ? unwrappedSnapshot : null;
  const windowKey = key === 'primary' ? 'primary_window' : 'secondary_window';
  const camelWindowKey = key === 'primary' ? 'primaryWindow' : 'secondaryWindow';
  const candidate = snapshot?.[key] ?? snapshot?.[windowKey] ?? snapshot?.[camelWindowKey];
  const meter = isRecord(candidate) ? candidate : null;
  return meter;
}

export function isCodexRateLimitSnapshotExhausted(rawSnapshot: unknown): boolean {
  for (const key of ['primary', 'secondary'] as const) {
    const meter = readCodexRateLimitMeter(rawSnapshot, key);
    const usedPercent = readFiniteNumber(meter?.usedPercent ?? meter?.used_percent ?? meter?.utilizationPct ?? meter?.utilization_pct);
    if (usedPercent !== null && usedPercent >= 100) return true;
    const status = readString(meter?.status)?.toLowerCase();
    if (status === 'exhausted' || status === 'limited' || status === 'rate_limited') return true;
  }
  return false;
}

function readRelativeResetSeconds(meter: Record<string, unknown> | null): number | null {
  const seconds = readFiniteNumber(meter?.resetsInSeconds ?? meter?.resets_in_seconds);
  return seconds !== null && seconds >= 0 ? seconds : null;
}

/**
 * Resolve a meter's reset timing. Absolute fields win; legacy relative
 * `resets_in_seconds` shapes are converted to an absolute timestamp against
 * `nowMs` at read time (RD-QUO-1) so durable-wait arming gets true reset timing.
 */
function readCodexRateLimitMeterResetAtMs(meter: Record<string, unknown> | null, nowMs: number): number | null {
  const absolute = parseProviderTimestampMs(meter?.resetsAt ?? meter?.resets_at ?? meter?.resetAt ?? meter?.reset_at);
  if (absolute !== null) return absolute;
  const relativeSeconds = readRelativeResetSeconds(meter);
  return relativeSeconds !== null ? Math.trunc(nowMs + relativeSeconds * 1000) : null;
}

export function readEarliestCodexRateLimitResetAtMs(rawSnapshot: unknown, nowMs: number = Date.now()): number | null {
  const resets = (['primary', 'secondary'] as const)
    .map((key) => readCodexRateLimitMeterResetAtMs(readCodexRateLimitMeter(rawSnapshot, key), nowMs))
    .filter((value): value is number => value !== null);
  return resets.length > 0 ? Math.min(...resets) : null;
}

export function readCodexRateLimitPlanType(rawSnapshot: unknown): string | null {
  const unwrappedSnapshot = unwrapCodexRateLimitSnapshot(rawSnapshot);
  const snapshot = isRecord(unwrappedSnapshot) ? unwrappedSnapshot : null;
  return readString(snapshot?.plan_type ?? snapshot?.planType);
}
