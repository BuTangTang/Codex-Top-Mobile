import { createBackoffSessionUsageLimitRecoveryControlAdapter } from '@/session/usageLimitRecoveryControls/createBackoffSessionUsageLimitRecoveryControlAdapter';
import type { SessionUsageLimitRecoveryControlAdapter } from '@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryControlTypes';

const OPENCODE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_ENV =
  'HAPPIER_OPENCODE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_MS' as const;
const OPENCODE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS_ENV =
  'HAPPIER_OPENCODE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS' as const;
const DEFAULT_OPENCODE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_MS = 600_000;
const DEFAULT_OPENCODE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS = 3;

export function createOpenCodeUsageLimitRecoveryControlAdapter(deps: Readonly<{
  nowMs?: () => number;
  processEnv?: NodeJS.ProcessEnv;
}> = {}): SessionUsageLimitRecoveryControlAdapter {
  return createBackoffSessionUsageLimitRecoveryControlAdapter({
    providerId: 'opencode',
    fallbackBackoffEnvKey: OPENCODE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_ENV,
    maxAttemptsEnvKey: OPENCODE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS_ENV,
    defaultFallbackBackoffMs: DEFAULT_OPENCODE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_MS,
    defaultMaxAttempts: DEFAULT_OPENCODE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS,
    ...deps,
  });
}

export const openCodeUsageLimitRecoveryControlAdapter =
  createOpenCodeUsageLimitRecoveryControlAdapter();
