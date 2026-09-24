import { describe, expect, it } from 'vitest';

import {
  CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS,
  CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES,
  ConnectedServiceUxDiagnosticV1Schema,
  isConnectedServiceUxDiagnosticV1,
  normalizeConnectedServiceUxDiagnosticV1,
} from './connectedServiceUxDiagnostics.js';

describe('ConnectedServiceUxDiagnosticV1', () => {
  it('accepts the shared safe diagnostic shape used by CLI and UI surfaces', () => {
    const diagnostic = ConnectedServiceUxDiagnosticV1Schema.parse({
      code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.providerAccountAdoptionMismatch,
      failurePhase: 'post_switch_verification',
      source: 'manual_auth_switch',
      serviceId: 'openai-codex',
      providerId: 'codex',
      agentId: 'codex',
      profileId: 'backup',
      groupId: 'codex-main',
      retryable: true,
      suggestedActions: [
        CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry,
        CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.openConnectedAccounts,
      ],
      diagnostics: {
        reason: 'provider reported a different active account',
        attemptCount: 1,
        recovered: false,
      },
    });

    expect(diagnostic).toMatchObject({
      code: 'provider_account_adoption_mismatch',
      failurePhase: 'post_switch_verification',
      source: 'manual_auth_switch',
      retryable: true,
      suggestedActions: ['retry', 'open_connected_accounts'],
    });
  });

  it('rejects raw nested provider payloads from diagnostics', () => {
    expect(() => ConnectedServiceUxDiagnosticV1Schema.parse({
      code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.providerSessionStateUnavailableForResume,
      failurePhase: 'continuity',
      source: 'spawn_resume',
      retryable: false,
      suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.startFreshUnderSelectedAccount],
      diagnostics: {
        tokenPayload: { accessToken: 'secret' },
      },
    })).toThrow();
  });

  it('rejects diagnostic records with too many keys', () => {
    expect(() => ConnectedServiceUxDiagnosticV1Schema.parse({
      code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryRetryScheduled,
      failurePhase: 'runtime_auth_recovery',
      source: 'runtime_auth_recovery',
      retryable: true,
      suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry],
      diagnostics: Object.fromEntries(
        Array.from({ length: 17 }, (_value, index) => [`key${index}`, `value${index}`]),
      ),
    })).toThrow();
  });

  it('rejects diagnostic string values that are too long for UI transport', () => {
    expect(() => ConnectedServiceUxDiagnosticV1Schema.parse({
      code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryRetryScheduled,
      failurePhase: 'runtime_auth_recovery',
      source: 'runtime_auth_recovery',
      retryable: true,
      suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry],
      diagnostics: {
        reason: 'x'.repeat(513),
      },
    })).toThrow();
  });

  it('rejects obvious secret-bearing diagnostic keys', () => {
    expect(() => ConnectedServiceUxDiagnosticV1Schema.parse({
      code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryRetryScheduled,
      failurePhase: 'runtime_auth_recovery',
      source: 'runtime_auth_recovery',
      retryable: true,
      suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry],
      diagnostics: {
        accessToken: 'secret',
      },
    })).toThrow();
  });

  it('rejects generic token-bearing diagnostic keys', () => {
    for (const key of ['token', 'sessionToken']) {
      expect(() => ConnectedServiceUxDiagnosticV1Schema.parse({
        code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryRetryScheduled,
        failurePhase: 'runtime_auth_recovery',
        source: 'runtime_auth_recovery',
        retryable: true,
        suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry],
        diagnostics: {
          [key]: 'secret',
        },
      })).toThrow();
    }
  });

  it('defaults omitted suggested actions to an empty protocol-valid array', () => {
    const payload = {
      code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryRetryScheduled,
      failurePhase: 'runtime_auth_recovery',
      source: 'runtime_auth_recovery',
      retryable: true,
    };
    const diagnostic = ConnectedServiceUxDiagnosticV1Schema.parse(payload);

    expect(diagnostic.suggestedActions).toEqual([]);
    expect(normalizeConnectedServiceUxDiagnosticV1(payload)?.suggestedActions).toEqual([]);
    expect(isConnectedServiceUxDiagnosticV1(payload)).toBe(false);
    expect(isConnectedServiceUxDiagnosticV1(diagnostic)).toBe(true);
  });

  it('accepts scheduled and dead-lettered runtime-auth recovery diagnostics with scoped service metadata', () => {
    const scheduled = ConnectedServiceUxDiagnosticV1Schema.safeParse({
      code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryRetryScheduled,
      failurePhase: 'runtime_auth_recovery',
      source: 'runtime_auth_recovery',
      serviceId: 'openai-codex',
      profileId: 'backup',
      groupId: 'codex-main',
      retryable: true,
      suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry],
      diagnostics: {
        attempt: 2,
        nextRetryAtMs: 1_900_000_000_000,
      },
    });
    const deadLettered = ConnectedServiceUxDiagnosticV1Schema.safeParse({
      code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryDeadLettered,
      failurePhase: 'runtime_auth_recovery',
      source: 'runtime_auth_recovery',
      serviceId: 'openai-codex',
      profileId: 'backup',
      groupId: 'codex-main',
      retryable: false,
      suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.openConnectedAccounts],
      diagnostics: {
        attempt: 5,
        terminal: true,
      },
    });

    expect(scheduled.success).toBe(true);
    expect(deadLettered.success).toBe(true);
  });

  it('accepts usage-limit recovery as a distinct diagnostic source from manual and runtime-auth flows', () => {
    const diagnostic = ConnectedServiceUxDiagnosticV1Schema.parse({
      code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.metadataUpdateFailed,
      failurePhase: 'metadata',
      source: 'usage_limit_recovery',
      serviceId: 'openai-codex',
      profileId: 'backup',
      groupId: 'codex-main',
      retryable: true,
      suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry],
      diagnostics: {
        reason: 'pre-turn quota switch could not persist the target binding',
      },
    });

    expect(diagnostic.source).toBe('usage_limit_recovery');
  });

  it.each([
    'claude_subscription_missing_claude_code_scope',
    'claude_subscription_native_auth_materialization_failed',
    'claude_subscription_setup_token_not_supported_for_unified',
  ])('accepts Claude native-auth diagnostic code %s as a first-class UX diagnostic', (code) => {
    const diagnostic = ConnectedServiceUxDiagnosticV1Schema.safeParse({
      code,
      failurePhase: 'materialization',
      source: 'usage_limit_recovery',
      serviceId: 'claude-subscription',
      providerId: 'claude',
      agentId: 'claude',
      profileId: 'claude-profile',
      retryable: false,
      suggestedActions: [
        CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.reconnectProfile,
        CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.openConnectedAccounts,
      ],
      diagnostics: {
        materializationReason: code,
      },
    });

    expect(diagnostic.success).toBe(true);
  });

  it('accepts a provider-agnostic credential reconnect diagnostic', () => {
    const diagnostic = ConnectedServiceUxDiagnosticV1Schema.safeParse({
      code: 'connected_service_credential_reconnect_required',
      failurePhase: 'materialization',
      source: 'spawn_resume',
      serviceId: 'claude-subscription',
      providerId: 'claude',
      agentId: 'claude',
      profileId: 'batiplus',
      retryable: false,
      suggestedActions: [
        CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.reconnectProfile,
        CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.openConnectedAccounts,
      ],
      diagnostics: {
        reason: 'spawn_preflight',
        refreshStatus: 'refresh_failed',
        refreshCategory: 'invalid_grant',
      },
    });

    expect(diagnostic.success).toBe(true);
  });

  it.each([
    ['runtime_auth_recovery_superseded', 'runtime_auth_recovery', 'runtime_auth_recovery'],
    ['runtime_auth_generation_stale', 'runtime_auth_recovery', 'runtime_auth_recovery'],
    ['hot_apply_unavailable', 'hot_apply', 'manual_auth_switch'],
    ['app_server_unavailable', 'post_switch_verification', 'transcript_switch_attempt'],
    ['provider_account_identity_unverified', 'post_switch_verification', 'usage_limit_recovery'],
    ['quota_snapshot_stale', 'runtime_auth_recovery', 'usage_limit_recovery'],
    ['quota_fetch_disabled', 'runtime_auth_recovery', 'usage_limit_recovery'],
    ['quota_fetch_backoff', 'runtime_auth_recovery', 'usage_limit_recovery'],
    ['auth_surface_weakly_verified', 'post_switch_verification', 'runtime_auth_recovery'],
  ] as const)('accepts recovery diagnostic code %s as a first-class UX diagnostic', (code, failurePhase, source) => {
    const diagnostic = ConnectedServiceUxDiagnosticV1Schema.safeParse({
      code,
      failurePhase,
      source,
      serviceId: 'openai-codex',
      providerId: 'codex',
      agentId: 'codex',
      profileId: 'backup',
      groupId: 'codex-main',
      retryable: code !== 'auth_surface_weakly_verified',
      suggestedActions: [
        CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry,
        CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.openConnectedAccounts,
      ],
      diagnostics: {
        reason: code,
      },
    });

    expect(diagnostic.success).toBe(true);
  });
});
