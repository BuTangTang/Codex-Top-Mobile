import { describe, expect, it } from 'vitest';

import {
  SessionRuntimeIssueV1Schema,
  SessionRuntimeTemporaryThrottleDetailsV1Schema,
  SessionRuntimeUsageLimitDetailsV1Schema,
} from './runtimeIssueV1.js';

describe('SessionRuntimeUsageLimitDetailsV1Schema', () => {
  const baseDetails = {
    v: 1,
    resetAtMs: 1_000,
    retryAfterMs: 500,
    quotaScope: 'account',
    recoverability: 'wait',
  } as const;

  it('requires a URL for open_url actions', () => {
    expect(() => SessionRuntimeUsageLimitDetailsV1Schema.parse({
      ...baseDetails,
      action: {
        kind: 'open_url',
        labelKey: 'provider_usage_settings',
      },
    })).toThrow();

    expect(SessionRuntimeUsageLimitDetailsV1Schema.parse({
      ...baseDetails,
      action: {
        kind: 'open_url',
        labelKey: 'provider_usage_settings',
        url: 'https://example.com/usage',
      },
    }).action).toEqual({
      kind: 'open_url',
      labelKey: 'provider_usage_settings',
      url: 'https://example.com/usage',
    });
  });

  it('keeps settings and none actions minimal', () => {
    expect(SessionRuntimeUsageLimitDetailsV1Schema.parse({
      ...baseDetails,
      action: {
        kind: 'settings',
      },
    }).action).toEqual({
      kind: 'settings',
    });
    expect(SessionRuntimeUsageLimitDetailsV1Schema.parse({
      ...baseDetails,
      action: {
        kind: 'none',
      },
    }).action).toEqual({
      kind: 'none',
    });

    expect(() => SessionRuntimeUsageLimitDetailsV1Schema.parse({
      ...baseDetails,
      action: {
        kind: 'settings',
        url: 'https://example.com/usage',
      },
    })).toThrow();
    expect(() => SessionRuntimeUsageLimitDetailsV1Schema.parse({
      ...baseDetails,
      action: {
        kind: 'none',
        labelKey: 'provider_usage_settings',
      },
    })).toThrow();
  });

  it('parses normalized limit category and effective meter recovery fields', () => {
    const parsed = SessionRuntimeUsageLimitDetailsV1Schema.parse({
      ...baseDetails,
      limitCategory: 'quota',
      quotaSnapshotRef: {
        serviceId: 'openai-codex',
        profileId: 'work',
        groupId: 'codex-main',
        fetchedAtMs: 2_000,
      },
      effectiveMeterId: 'weekly',
      effectiveRemainingPct: 7,
      allWindows: [
        {
          meterId: 'daily',
          scope: 'daily',
          remainingPct: 42,
          resetAtMs: 3_000,
          status: 'ok',
        },
        {
          meterId: 'weekly',
          scope: 'weekly',
          remainingPct: 7,
          resetAtMs: 4_000,
          status: 'ok',
        },
      ],
      recoveryDecision: 'switching',
    });

    expect(parsed.limitCategory).toBe('usage_limit');
    expect(parsed.effectiveMeterId).toBe('weekly');
    expect(parsed.effectiveRemainingPct).toBe(7);
    expect(parsed.allWindows).toHaveLength(2);
    expect(parsed.recoveryDecision).toBe('switching');
  });

  it('normalizes legacy runtime issue limit categories to canonical public names', () => {
    expect(SessionRuntimeUsageLimitDetailsV1Schema.parse({
      ...baseDetails,
      limitCategory: 'auth',
    }).limitCategory).toBe('auth_invalid');

    expect(SessionRuntimeUsageLimitDetailsV1Schema.parse({
      ...baseDetails,
      limitCategory: 'plan',
    }).limitCategory).toBe('plan_invalid');
  });

  it('parses temporary provider throttle details outside usage-limit details', () => {
    const throttle = SessionRuntimeTemporaryThrottleDetailsV1Schema.parse({
      v: 1,
      retryAfterMs: 30_000,
      recoverability: 'retry',
    });

    expect(throttle).toEqual({
      v: 1,
      retryAfterMs: 30_000,
      recoverability: 'retry',
    });
    expect(SessionRuntimeIssueV1Schema.parse({
      v: 1,
      scope: 'primary_session',
      status: 'failed',
      code: 'provider_temporary_throttle',
      source: 'provider_status_error',
      occurredAt: 1_000,
      provider: 'codex',
      sanitizedPreview: 'Provider is temporarily limiting requests',
      temporaryThrottle: throttle,
    })).toMatchObject({
      source: 'provider_status_error',
      temporaryThrottle: throttle,
    });
  });

  it('parses dependency failures as first-class runtime issues', () => {
    expect(SessionRuntimeIssueV1Schema.parse({
      v: 1,
      scope: 'primary_session',
      status: 'failed',
      code: 'dependency_failure',
      source: 'dependency_failure',
      occurredAt: 1_000,
      provider: 'pi',
      sanitizedPreview: 'Provider dependency failed',
    })).toMatchObject({
      code: 'dependency_failure',
      source: 'dependency_failure',
    });
  });

  it('parses provider process exits after connected-service switches', () => {
    expect(SessionRuntimeIssueV1Schema.parse({
      v: 1,
      scope: 'primary_session',
      status: 'failed',
      code: 'provider_process_exit_after_switch',
      source: 'provider_process_exit_after_switch',
      occurredAt: 1_000,
      provider: 'pi',
      sanitizedPreview: 'Provider process exited after connected-service switch',
      providerProcessExitAfterSwitch: {
        exitCode: 1,
        signal: null,
        lastStderrLine: 'session file missing',
        vendorResumeId: 'resume_123',
        materializationRoot: '/tmp/happier/pi-home',
        effectiveStateMode: 'isolated',
      },
    })).toMatchObject({
      source: 'provider_process_exit_after_switch',
      providerProcessExitAfterSwitch: {
        exitCode: 1,
        signal: null,
        lastStderrLine: 'session file missing',
        vendorResumeId: 'resume_123',
        materializationRoot: '/tmp/happier/pi-home',
        effectiveStateMode: 'isolated',
      },
    });
  });
});
