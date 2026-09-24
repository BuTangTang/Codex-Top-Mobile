import type { ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';
import { createHmac, hkdfSync } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const SAFE_METER_DETAILS_KEYS = [
  'code',
  'limitCategory',
  'note',
  'providerLimitId',
  'rawScope',
  'remainingPct',
  'scope',
] as const;

function sortRecord(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortRecord);
  if (!value || typeof value !== 'object') return value;
  const out: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortRecord(value[key] ?? null);
  }
  return out;
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(sortRecord(value));
}

function readJsonScalar(value: unknown): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'string':
      return Number.isNaN(value) ? null : value;
    default:
      return null;
  }
}

function materialDetails(details: ConnectedServiceQuotaSnapshotV1['meters'][number]['details']): JsonValue {
  const source = details && typeof details === 'object' ? details as Record<string, unknown> : {};
  const out: { [key: string]: JsonValue } = {};
  for (const key of SAFE_METER_DETAILS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = readJsonScalar(source[key]);
    }
  }
  return out;
}

function materialSnapshot(snapshot: ConnectedServiceQuotaSnapshotV1): JsonValue {
  return {
    v: snapshot.v,
    serviceId: snapshot.serviceId,
    profileId: snapshot.profileId,
    staleAfterMs: snapshot.staleAfterMs,
    planLabel: snapshot.planLabel,
    accountLabel: snapshot.accountLabel,
    providerId: snapshot.providerId ?? null,
    source: snapshot.source ?? null,
    confidence: snapshot.confidence ?? null,
    evidence: snapshot.evidence
      ? {
          kind: snapshot.evidence.kind ?? null,
          status: snapshot.evidence.status ?? null,
          code: snapshot.evidence.code ?? null,
          providerLimitId: snapshot.evidence.providerLimitId ?? null,
        }
      : null,
    meters: [...snapshot.meters]
      .map((meter) => ({
        meterId: meter.meterId,
        label: meter.label,
        used: meter.used,
        limit: meter.limit,
        remaining: meter.remaining ?? null,
        remainingPct: meter.remainingPct ?? null,
        usedPct: meter.usedPct ?? null,
        resetAtMs: meter.resetAtMs ?? null,
        resetSource: meter.resetSource ?? null,
        providerLimitId: meter.providerLimitId ?? null,
        modelId: meter.modelId ?? null,
        isExhausted: meter.isExhausted ?? null,
        isSoftLimited: meter.isSoftLimited ?? null,
        isCapacityLimited: meter.isCapacityLimited ?? null,
        unit: meter.unit,
        utilizationPct: meter.utilizationPct,
        resetsAt: meter.resetsAt,
        status: meter.status,
        source: meter.source ?? null,
        scope: meter.scope ?? null,
        limitScope: meter.limitScope ?? null,
        confidence: meter.confidence ?? null,
        details: materialDetails(meter.details),
      }))
      .sort((left, right) => {
        const leftKey = `${left.meterId}\0${left.providerLimitId ?? ''}\0${left.label}`;
        const rightKey = `${right.meterId}\0${right.providerLimitId ?? ''}\0${right.label}`;
        return leftKey.localeCompare(rightKey);
      }),
  };
}

export function computeQuotaSnapshotFingerprint(
  snapshot: ConnectedServiceQuotaSnapshotV1,
  hmacKey: Uint8Array,
): string {
  return createHmac('sha256', Buffer.from(hmacKey))
    .update(stableJson(materialSnapshot(snapshot)))
    .digest('hex')
    .slice(0, 32);
}

export function deriveQuotaSnapshotFingerprintHmacKey(input: Readonly<{
  keyMaterial: Uint8Array;
  serverScope: string;
  accountScope: string;
}>): Uint8Array {
  const salt = Buffer.from(`happier:quota-snapshot-dedup:${input.serverScope}`, 'utf8');
  const info = Buffer.from(`account:${input.accountScope}`, 'utf8');
  return new Uint8Array(hkdfSync('sha256', Buffer.from(input.keyMaterial), salt, info, 32));
}
