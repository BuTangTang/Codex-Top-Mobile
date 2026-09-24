import { describe, expect, it } from 'vitest';

import type { ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';

import {
  computeQuotaSnapshotFingerprint,
  deriveQuotaSnapshotFingerprintHmacKey,
} from './quotaSnapshotFingerprint';

function buildSnapshot(overrides: Partial<ConnectedServiceQuotaSnapshotV1> = {}): ConnectedServiceQuotaSnapshotV1 {
  return {
    v: 1,
    serviceId: 'openai-codex',
    profileId: 'primary',
    fetchedAt: 1_000,
    staleAfterMs: 300_000,
    planLabel: 'pro',
    accountLabel: 'user@example.com',
    meters: [
      {
        meterId: 'primary',
        label: 'Primary',
        used: 12,
        limit: 100,
        unit: 'requests',
        utilizationPct: 12,
        remainingPct: 88,
        resetsAt: 10_000,
        status: 'ok',
        details: {
          providerLimitId: 'window-a',
          limitCategory: 'usage_limit',
        },
      },
    ],
    ...overrides,
  };
}

describe('computeQuotaSnapshotFingerprint', () => {
  const hmacKey = new Uint8Array(32).fill(7);

  it('returns a stable 128-bit hex HMAC for equal logical snapshots', () => {
    const first = computeQuotaSnapshotFingerprint(buildSnapshot({ fetchedAt: 1_000 }), hmacKey);
    const second = computeQuotaSnapshotFingerprint(buildSnapshot({ fetchedAt: 2_000 }), hmacKey);

    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).toBe(first);
  });

  it('changes when material quota fields change', () => {
    const original = computeQuotaSnapshotFingerprint(buildSnapshot(), hmacKey);
    const changed = computeQuotaSnapshotFingerprint(buildSnapshot({
      meters: [
        {
          ...buildSnapshot().meters[0],
          remainingPct: 9,
          utilizationPct: 91,
        },
      ],
    }), hmacKey);

    expect(changed).not.toBe(original);
  });

  it('uses HMAC key separation for account/server-scoped dedupe material', () => {
    const snapshot = buildSnapshot();

    expect(computeQuotaSnapshotFingerprint(snapshot, new Uint8Array(32).fill(1)))
      .not.toBe(computeQuotaSnapshotFingerprint(snapshot, new Uint8Array(32).fill(2)));
  });

  it('derives account and server scoped HMAC keys from client-side key material', () => {
    const keyMaterial = new Uint8Array(32).fill(3);
    const first = deriveQuotaSnapshotFingerprintHmacKey({
      keyMaterial,
      serverScope: 'server-a',
      accountScope: 'account-a',
    });
    const same = deriveQuotaSnapshotFingerprintHmacKey({
      keyMaterial,
      serverScope: 'server-a',
      accountScope: 'account-a',
    });
    const differentServer = deriveQuotaSnapshotFingerprintHmacKey({
      keyMaterial,
      serverScope: 'server-b',
      accountScope: 'account-a',
    });
    const differentAccount = deriveQuotaSnapshotFingerprintHmacKey({
      keyMaterial,
      serverScope: 'server-a',
      accountScope: 'account-b',
    });

    expect(Buffer.from(same).toString('hex')).toBe(Buffer.from(first).toString('hex'));
    expect(Buffer.from(differentServer).toString('hex')).not.toBe(Buffer.from(first).toString('hex'));
    expect(Buffer.from(differentAccount).toString('hex')).not.toBe(Buffer.from(first).toString('hex'));
  });

  it('does not include unsafe provider raw body fields from details', () => {
    const original = computeQuotaSnapshotFingerprint(buildSnapshot({
      meters: [{
        ...buildSnapshot().meters[0],
        details: { code: 'same' },
      }],
    }), hmacKey);
    const withUnsafeExtra = computeQuotaSnapshotFingerprint(buildSnapshot({
      meters: [{
        ...buildSnapshot().meters[0],
        details: {
          code: 'same',
          rawBody: '{"access_token":"secret"}',
        } as unknown as ConnectedServiceQuotaSnapshotV1['meters'][number]['details'],
      }],
    }), hmacKey);

    expect(withUnsafeExtra).toBe(original);
  });
});
