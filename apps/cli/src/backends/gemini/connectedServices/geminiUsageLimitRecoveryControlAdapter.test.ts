import { describe, expect, it, vi } from 'vitest';

import {
  SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY,
  buildConnectedServiceCredentialRecord,
  type ConnectedServiceCredentialRecordV1,
  type SessionUsageLimitRecoveryV1,
} from '@happier-dev/protocol';
import type { Credentials } from '@/persistence';
import type { SessionUsageLimitRecoveryControlAdapterParams } from '@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryControlTypes';
import { createGeminiUsageLimitRecoveryControlAdapter } from './geminiUsageLimitRecoveryControlAdapter';

function createCredentials(): Credentials {
  return {
    token: 'token',
    encryption: {
      type: 'legacy',
      secret: new Uint8Array(32).fill(9),
    },
  };
}

function createGeminiRecord(): ConnectedServiceCredentialRecordV1 {
  return buildConnectedServiceCredentialRecord({
    now: 1_700_000_000_000,
    serviceId: 'gemini',
    profileId: 'gemini-work',
    kind: 'oauth',
    expiresAt: 1_700_000_060_000,
    oauth: {
      accessToken: 'gemini-access-token',
      refreshToken: 'gemini-refresh-token',
      idToken: 'gemini-id-token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      tokenType: 'Bearer',
      providerAccountId: 'google-account',
      providerEmail: 'user@example.com',
    },
  });
}

function createParams(
  metadata: Record<string, unknown>,
  rawSessionOverrides: Partial<SessionUsageLimitRecoveryControlAdapterParams['rawSession']> = {},
): SessionUsageLimitRecoveryControlAdapterParams {
  return {
    token: 'token',
    credentials: createCredentials(),
    sessionId: 'sess_1',
    rawSession: {
      id: 'sess_1',
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      active: false,
      activeAt: 1,
      path: '/repo',
      machineId: 'machine-local',
      metadata: '{}',
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataEncryptionKey: null,
      ...rawSessionOverrides,
    },
    metadata,
    currentMachineId: 'machine-local',
    sessionMachineId: 'machine-local',
    cwd: '/repo',
    ctx: {
      encryptionKey: new Uint8Array(32).fill(1),
      encryptionVariant: 'legacy' as const,
    },
    mode: 'plain' as const,
  };
}

describe('geminiUsageLimitRecoveryControlAdapter', () => {
  it('probes the selected Gemini connected-service credential and marks recovery ready when quota is available', async () => {
    const record = createGeminiRecord();
    const resolveCredential = vi.fn(async () => record);
    const probeQuota = vi.fn(async () => ({
      status: 'available',
      quotaSnapshot: {
        v: 1,
        serviceId: 'gemini',
        profileId: 'gemini-work',
        fetchedAt: 1_800_000_000_000,
        staleAfterMs: 300_000,
        planLabel: null,
        accountLabel: null,
        meters: [
          {
            meterId: 'gemini-2.5-pro',
            label: 'gemini-2.5-pro',
            used: 10,
            limit: 100,
            unit: 'count',
            utilizationPct: 10,
            resetsAt: Date.parse('2026-05-18T12:00:00.000Z'),
            status: 'ok',
            details: {},
          },
        ],
      },
    }));
    const adapter = createGeminiUsageLimitRecoveryControlAdapter({ resolveCredential, probeQuota });

    await expect(adapter.checkNow?.(createParams({
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: { v: 1, providerId: 'gemini' },
      [SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]: {
        v: 1,
        status: 'waiting',
        issueFingerprint: 'usage-limit:gemini:turn-1:1700000000000:no-reset',
        armedAtMs: 1_700_000_000_000,
        resetAtMs: null,
        nextCheckAtMs: null,
        attemptCount: 0,
        maxAttempts: 3,
        lastProbeError: null,
        selectedAuth: {
          kind: 'group',
          serviceId: 'gemini',
          groupId: 'gemini-group',
          profileId: 'gemini-work',
        },
      },
    }))).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          status: 'cancelled',
          attemptCount: 1,
        },
      },
    });

    expect(resolveCredential).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 'gemini',
      profileId: 'gemini-work',
    }));
    expect(probeQuota).toHaveBeenCalledWith({
      target: { agentId: 'gemini' },
      selection: {
        groupId: 'gemini-group',
        record,
      },
    });
  });

  it('keeps waiting and records the next reset when Gemini quota remains exhausted', async () => {
    const adapter = createGeminiUsageLimitRecoveryControlAdapter({
      resolveCredential: vi.fn(async () => createGeminiRecord()),
      probeQuota: vi.fn(async () => ({
        status: 'available',
        quotaSnapshot: {
          v: 1,
          serviceId: 'gemini',
          profileId: 'gemini-work',
          fetchedAt: 1_800_000_000_000,
          staleAfterMs: 300_000,
          planLabel: null,
          accountLabel: null,
          meters: [
            {
              meterId: 'gemini-2.5-pro',
              label: 'gemini-2.5-pro',
              used: 100,
              limit: 100,
              unit: 'count',
              utilizationPct: 100,
              resetsAt: Date.parse('2026-05-18T12:00:00.000Z'),
              status: 'ok',
              details: {},
            },
          ],
        },
      })),
    });

    await expect(adapter.checkNow?.(createParams({
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: { v: 1, providerId: 'gemini' },
    }, {
      latestTurnStatus: 'failed',
      lastRuntimeIssue: {
        v: 1,
        scope: 'primary_session',
        status: 'failed',
        code: 'usage_limit',
        source: 'usage_limit',
        provider: 'gemini',
        providerTurnId: 'turn-1',
        occurredAt: 1_700_000_000_000,
        usageLimit: {
          v: 1,
          resetAtMs: null,
          retryAfterMs: null,
          quotaScope: 'account',
          recoverability: 'wait',
          connectedService: {
            serviceId: 'gemini',
            profileId: 'gemini-work',
            groupId: null,
          },
        },
      },
    }))).resolves.toMatchObject({
      ok: true,
      status: 'waiting',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          status: 'waiting',
          attemptCount: 1,
          resetAtMs: Date.parse('2026-05-18T12:00:00.000Z'),
          nextCheckAtMs: Date.parse('2026-05-18T12:00:00.000Z'),
          selectedAuth: {
            kind: 'profile',
            serviceId: 'gemini',
            profileId: 'gemini-work',
          },
        },
      },
    });
  });

  it('preserves group identity when the latest failed usage-limit issue has no active profile id', async () => {
    const resolveCredential = vi.fn(async () => null);
    const probeQuota = vi.fn();
    const adapter = createGeminiUsageLimitRecoveryControlAdapter({ resolveCredential, probeQuota });

    await expect(adapter.checkNow?.(createParams({
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: { v: 1, providerId: 'gemini' },
    }, {
      latestTurnStatus: 'failed',
      lastRuntimeIssue: {
        v: 1,
        scope: 'primary_session',
        status: 'failed',
        code: 'usage_limit',
        source: 'usage_limit',
        provider: 'gemini',
        providerTurnId: 'turn-1',
        occurredAt: 1_700_000_000_000,
        usageLimit: {
          v: 1,
          resetAtMs: null,
          retryAfterMs: 120_000,
          quotaScope: 'account',
          recoverability: 'wait',
          connectedService: {
            serviceId: 'gemini',
            groupId: 'gemini-main',
            profileId: null,
          },
        },
      },
    }))).resolves.toMatchObject({
      ok: true,
      status: 'waiting',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          selectedAuth: {
            kind: 'group',
            serviceId: 'gemini',
            groupId: 'gemini-main',
            profileId: null,
          },
        },
      },
    });
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(probeQuota).not.toHaveBeenCalled();
  });

  it('exhausts stale Gemini recovery intents instead of probing after max attempts', async () => {
    const resolveCredential = vi.fn(async () => createGeminiRecord());
    const probeQuota = vi.fn(async () => ({
      status: 'available',
      quotaSnapshot: {
        v: 1,
        serviceId: 'gemini',
        profileId: 'gemini-work',
        fetchedAt: 1_800_000_000_000,
        staleAfterMs: 300_000,
        planLabel: null,
        accountLabel: null,
        meters: [
          {
            meterId: 'gemini-2.5-pro',
            label: 'gemini-2.5-pro',
            used: 100,
            limit: 100,
            unit: 'count',
            utilizationPct: 100,
            resetsAt: Date.parse('2026-05-18T12:00:00.000Z'),
            status: 'ok',
            details: {},
          },
        ],
      },
    }));
    const intent: SessionUsageLimitRecoveryV1 = {
      v: 1,
      status: 'waiting',
      issueFingerprint: 'usage-limit:gemini:turn-1:1700000000000:no-reset',
      armedAtMs: 1_700_000_000_000,
      resetAtMs: null,
      nextCheckAtMs: null,
      attemptCount: 1,
      maxAttempts: 1,
      lastProbeError: null,
      resumePromptMode: 'standard',
      selectedAuth: {
        kind: 'profile',
        serviceId: 'gemini',
        profileId: 'gemini-work',
      },
    };
    const adapter = createGeminiUsageLimitRecoveryControlAdapter({ resolveCredential, probeQuota });

    await expect(adapter.checkNow?.(createParams({
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: { v: 1, providerId: 'gemini' },
      [SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]: intent,
    }))).resolves.toMatchObject({
      ok: true,
      status: 'waiting',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          status: 'exhausted',
          attemptCount: 2,
          lastProbeError: 'usage_limit_recovery_max_attempts_exhausted',
        },
      },
    });
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(probeQuota).not.toHaveBeenCalled();
  });

  it('keeps retry-after-derived check timing when Gemini quota remains exhausted without a reset timestamp', async () => {
    const adapter = createGeminiUsageLimitRecoveryControlAdapter({
      resolveCredential: vi.fn(async () => createGeminiRecord()),
      probeQuota: vi.fn(async () => ({
        status: 'available',
        quotaSnapshot: {
          v: 1,
          serviceId: 'gemini',
          profileId: 'gemini-work',
          fetchedAt: 1_800_000_000_000,
          staleAfterMs: 300_000,
          planLabel: null,
          accountLabel: null,
          meters: [
            {
              meterId: 'gemini-2.5-pro',
              label: 'gemini-2.5-pro',
              used: 100,
              limit: 100,
              unit: 'count',
              utilizationPct: 100,
              resetsAt: null,
              status: 'ok',
              details: {},
            },
          ],
        },
      })),
    });

    await expect(adapter.checkNow?.(createParams({
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: { v: 1, providerId: 'gemini' },
    }, {
      latestTurnStatus: 'failed',
      lastRuntimeIssue: {
        v: 1,
        scope: 'primary_session',
        status: 'failed',
        code: 'usage_limit',
        source: 'usage_limit',
        provider: 'gemini',
        providerTurnId: 'turn-1',
        occurredAt: 1_700_000_000_000,
        usageLimit: {
          v: 1,
          resetAtMs: null,
          retryAfterMs: 120_000,
          quotaScope: 'account',
          recoverability: 'wait',
          connectedService: {
            serviceId: 'gemini',
            profileId: 'gemini-work',
            groupId: null,
          },
        },
      },
    }))).resolves.toMatchObject({
      ok: true,
      status: 'waiting',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          status: 'waiting',
          resetAtMs: null,
          nextCheckAtMs: 1_700_000_120_000,
        },
      },
    });
  });

  it('reports a stable error when the usage-limit issue has no Gemini connected-service credential selection', async () => {
    const adapter = createGeminiUsageLimitRecoveryControlAdapter({
      resolveCredential: vi.fn(async () => createGeminiRecord()),
      probeQuota: vi.fn(),
    });

    await expect(adapter.checkNow?.(createParams({
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: { v: 1, providerId: 'gemini' },
    }, {
      latestTurnStatus: 'failed',
      lastRuntimeIssue: {
        v: 1,
        scope: 'primary_session',
        status: 'failed',
        code: 'usage_limit',
        source: 'usage_limit',
        provider: 'gemini',
        providerTurnId: 'turn-1',
        occurredAt: 1_700_000_000_000,
        usageLimit: {
          v: 1,
          resetAtMs: null,
          retryAfterMs: null,
          quotaScope: 'account',
          recoverability: 'wait',
        },
      },
    }))).resolves.toEqual({
      ok: false,
      errorCode: 'session_usage_limit_recovery_control_connected_service_unavailable',
      error: 'session_usage_limit_recovery_control_connected_service_unavailable',
    });
  });
});
