import { describe, expect, it } from 'vitest';

import {
  SESSION_USAGE_LIMIT_RECOVERY_OPERATION_RESULT_ERROR_STATUSES_V1,
  SESSION_USAGE_LIMIT_RECOVERY_OPERATION_RESULT_OK_STATUSES_V1,
  SessionUsageLimitRecoveryOperationResultV1Schema,
  normalizeSessionUsageLimitRecoveryOperationResultV1,
} from './sessionUsageLimitRecoveryOperationResultV1.js';

const baseDiagnostic = {
  code: 'recovery_retry_scheduled',
  failurePhase: 'runtime_auth_recovery',
  source: 'usage_limit_recovery',
  serviceId: 'openai-codex',
  profileId: 'backup',
  groupId: 'codex-main',
  retryable: true,
  suggestedActions: ['retry'],
  diagnostics: {
    attempt: 2,
    nextRetryAtMs: 1_900_000_000_000,
  },
} as const;

describe('SessionUsageLimitRecoveryOperationResultV1', () => {
  it('accepts every ok status with optional retry, issue, diagnostics, and UX diagnostic fields', () => {
    for (const status of SESSION_USAGE_LIMIT_RECOVERY_OPERATION_RESULT_OK_STATUSES_V1) {
      const parsed = SessionUsageLimitRecoveryOperationResultV1Schema.parse({
        ok: true,
        status,
        sessionId: 'sess_123',
        issueFingerprint: 'usage-limit:sess_123:codex',
        retryAfterMs: 500.8,
        uxDiagnostic: baseDiagnostic,
        diagnostics: {
          source: 'unit',
          attempt: 1,
          retryable: true,
          empty: null,
        },
      });

      expect(parsed.status).toBe(status);
      expect(parsed.retryAfterMs).toBe(500);
      expect(parsed.uxDiagnostic?.suggestedActions).toEqual(['retry']);
    }
  });

  it('accepts every failure status with an error code and optional recovery context', () => {
    for (const status of SESSION_USAGE_LIMIT_RECOVERY_OPERATION_RESULT_ERROR_STATUSES_V1) {
      const parsed = SessionUsageLimitRecoveryOperationResultV1Schema.parse({
        ok: false,
        status,
        sessionId: 'sess_123',
        errorCode: `session_usage_limit_recovery_control_${status}`,
        retryAfterMs: 250.2,
        issueFingerprint: 'usage-limit:sess_123:codex',
        uxDiagnostic: baseDiagnostic,
        diagnostics: {
          status,
        },
      });

      expect(parsed.status).toBe(status);
      expect(parsed.errorCode).toBe(`session_usage_limit_recovery_control_${status}`);
      expect(parsed.retryAfterMs).toBe(250);
    }
  });

  it('rejects malformed union payloads', () => {
    expect(SessionUsageLimitRecoveryOperationResultV1Schema.safeParse({
      ok: true,
      status: 'ready',
    }).success).toBe(false);
    expect(SessionUsageLimitRecoveryOperationResultV1Schema.safeParse({
      ok: false,
      status: 'unsupported',
    }).success).toBe(false);
    expect(SessionUsageLimitRecoveryOperationResultV1Schema.safeParse({
      ok: true,
      status: 'not-a-status',
      sessionId: 'sess_123',
    }).success).toBe(false);
    expect(SessionUsageLimitRecoveryOperationResultV1Schema.safeParse({
      ok: false,
      status: 'unsupported',
      errorCode: 'unsupported',
      diagnostics: {
        nested: { unsafe: true },
      },
    }).success).toBe(false);
  });

  it('normalizes protocol-valid payloads without changing their meaning', () => {
    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      status: 'waiting',
      sessionId: 'sess_123',
      retryAfterMs: 123.9,
      issueFingerprint: 'usage-limit:sess_123:codex',
      resumePromptMode: 'off',
      uxDiagnostic: baseDiagnostic,
    })).toEqual({
      ok: true,
      status: 'waiting',
      sessionId: 'sess_123',
      retryAfterMs: 123,
      issueFingerprint: 'usage-limit:sess_123:codex',
      resumePromptMode: 'off',
      uxDiagnostic: baseDiagnostic,
    });
  });

  it('normalizes legacy ready and waiting envelopes with the caller session id', () => {
    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      recovery: { status: 'waiting' },
      retryAfterMs: 1_000.9,
    }, { sessionId: 'sess_123' })).toEqual({
      ok: true,
      status: 'waiting',
      sessionId: 'sess_123',
      retryAfterMs: 1_000,
    });

    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      status: 'ready',
    }, { sessionId: 'sess_123' })).toEqual({
      ok: true,
      status: 'ready',
      sessionId: 'sess_123',
    });
  });

  it('normalizes nested switch results into applied, observed, exhausted, conflict, and apply-failed statuses', () => {
    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      result: { status: 'switch_attempted', result: { status: 'switched' } },
    }, { sessionId: 'sess_123' })).toMatchObject({
      ok: true,
      status: 'switch_applied',
      sessionId: 'sess_123',
    });

    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      result: { status: 'switch_attempted', result: { status: 'observed_generation' } },
    }, { sessionId: 'sess_123' })).toMatchObject({
      ok: true,
      status: 'switch_observed',
      sessionId: 'sess_123',
    });

    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      result: { status: 'switch_attempted', result: { status: 'no_eligible_member' } },
    }, { sessionId: 'sess_123' })).toMatchObject({
      ok: false,
      status: 'exhausted',
      sessionId: 'sess_123',
      errorCode: 'session_usage_limit_recovery_control_no_eligible_member',
    });

    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      result: { status: 'switch_attempted', result: { status: 'selection_mismatch' } },
    }, { sessionId: 'sess_123' })).toMatchObject({
      ok: false,
      status: 'group_conflict',
      errorCode: 'session_usage_limit_recovery_control_issue_mismatch',
    });

    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      result: { status: 'switch_attempted', result: { status: 'generation_apply_failed' } },
    }, { sessionId: 'sess_123' })).toMatchObject({
      ok: false,
      status: 'generation_apply_failed',
      errorCode: 'session_usage_limit_recovery_control_switch_failed',
    });
  });

  it('inherits top-level context when normalizing nested legacy envelopes', () => {
    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      sessionId: 'sess_123',
      retryAfterMs: 700.7,
      issueFingerprint: 'usage-limit:sess_123:codex',
      uxDiagnostic: baseDiagnostic,
      result: { status: 'switch_attempted', result: { status: 'observed_generation' } },
    })).toEqual({
      ok: true,
      status: 'switch_observed',
      sessionId: 'sess_123',
      retryAfterMs: 700,
      issueFingerprint: 'usage-limit:sess_123:codex',
      uxDiagnostic: baseDiagnostic,
    });
  });

  it('fails closed for unknown success tokens, malformed responses, and missing session ids', () => {
    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      status: 'new-daemon-token',
    }, { sessionId: 'sess_123' })).toEqual({
      ok: false,
      status: 'unsupported',
      sessionId: 'sess_123',
      errorCode: 'unsupported_session_usage_limit_recovery_operation_result_status',
      diagnostics: { status: 'new-daemon-token' },
    });

    expect(normalizeSessionUsageLimitRecoveryOperationResultV1(null)).toEqual({
      ok: false,
      status: 'malformed_response',
      errorCode: 'malformed_session_usage_limit_recovery_operation_result',
    });

    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      status: 'ready',
    })).toEqual({
      ok: false,
      status: 'malformed_response',
      errorCode: 'missing_session_id',
    });

    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: true,
      status: 'waiting',
      sessionId: 'sess_123',
      resumePromptMode: 'sometimes',
    })).toEqual({
      ok: false,
      status: 'malformed_response',
      sessionId: 'sess_123',
      errorCode: 'malformed_session_usage_limit_recovery_resume_prompt_mode',
    });
  });

  it('preserves typed diagnostics on normalized errors and classifies rate limits', () => {
    expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
      ok: false,
      error: 'probe_rate_limited',
      errorCode: 'probe_rate_limited',
      retryAfterMs: 300.2,
      uxDiagnostic: baseDiagnostic,
    }, { sessionId: 'sess_123' })).toEqual({
      ok: false,
      status: 'rate_limited',
      sessionId: 'sess_123',
      errorCode: 'probe_rate_limited',
      retryAfterMs: 300,
      uxDiagnostic: baseDiagnostic,
    });
  });

  it('classifies producer boundary error codes in the shared protocol normalizer', () => {
    for (const errorCode of [
      'session_usage_limit_recovery_control_metadata_unavailable',
      'session_usage_limit_recovery_control_current_machine_unknown',
      'session_usage_limit_recovery_control_session_machine_unknown',
      'session_usage_limit_recovery_control_remote_unavailable',
      'session_usage_limit_recovery_resume_failed',
    ]) {
      expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
        ok: false,
        errorCode,
      }, { sessionId: 'sess_123' })).toEqual({
        ok: false,
        status: 'session_unreachable',
        sessionId: 'sess_123',
        errorCode,
      });
    }
  });

  it('classifies transport/parameter error codes like the dev normalizer (DEV-UIS-3 parity)', () => {
    // Missing RPC methods and unreachable transports are session reachability
    // failures, not "method unsupported" or "session not found".
    for (const errorCode of [
      'rpc_method_not_found',
      'rpc_method_not_available',
      'method_not_found',
      'method_not_available',
      'stale_machine',
      'server_unreachable',
    ]) {
      expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
        ok: false,
        errorCode,
      }, { sessionId: 'sess_123' })).toEqual({
        ok: false,
        status: 'session_unreachable',
        sessionId: 'sess_123',
        errorCode,
      });
    }
    // Caller-side parameter validation failures are malformed requests/responses.
    for (const errorCode of ['invalid_parameters', 'malformed_request']) {
      expect(normalizeSessionUsageLimitRecoveryOperationResultV1({
        ok: false,
        errorCode,
      }, { sessionId: 'sess_123' })).toEqual({
        ok: false,
        status: 'malformed_response',
        sessionId: 'sess_123',
        errorCode,
      });
    }
  });

  it('carries session metadata as a typed, serializable field on both branches (RD-REC-17)', () => {
    // Metadata must be part of the typed contract — never smuggled through
    // non-enumerable properties invisible to validation and JSON boundaries.
    const okResult = SessionUsageLimitRecoveryOperationResultV1Schema.parse({
      ok: true,
      status: 'ready',
      sessionId: 'sess_123',
      metadata: { usageLimitRecoveryV1: { status: 'waiting' } },
    });
    expect(okResult).toMatchObject({
      ok: true,
      metadata: { usageLimitRecoveryV1: { status: 'waiting' } },
    });
    expect(JSON.parse(JSON.stringify(okResult)).metadata).toEqual({
      usageLimitRecoveryV1: { status: 'waiting' },
    });

    const errorResult = SessionUsageLimitRecoveryOperationResultV1Schema.parse({
      ok: false,
      status: 'exhausted',
      sessionId: 'sess_123',
      errorCode: 'recovery_exhausted',
      metadata: { usageLimitRecoveryV1: null },
    });
    expect(errorResult).toMatchObject({
      ok: false,
      metadata: { usageLimitRecoveryV1: null },
    });
  });
});
