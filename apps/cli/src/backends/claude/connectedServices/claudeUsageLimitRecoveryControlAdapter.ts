import { createBackoffSessionUsageLimitRecoveryControlAdapter } from '@/session/usageLimitRecoveryControls/createBackoffSessionUsageLimitRecoveryControlAdapter';
import type { SessionUsageLimitRecoveryControlAdapter } from '@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryControlTypes';

const CLAUDE_SUBSCRIPTION_CONNECTED_SERVICE_ID = 'claude-subscription' as const;
const CLAUDE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_ENV =
  'HAPPIER_CLAUDE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_MS' as const;
const CLAUDE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS_ENV =
  'HAPPIER_CLAUDE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS' as const;
const DEFAULT_CLAUDE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_MS = 600_000;
const DEFAULT_CLAUDE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS = 3;

export function createClaudeUsageLimitRecoveryControlAdapter(deps: Readonly<{
  nowMs?: () => number;
  processEnv?: NodeJS.ProcessEnv;
}> = {}): SessionUsageLimitRecoveryControlAdapter {
  return createBackoffSessionUsageLimitRecoveryControlAdapter({
    providerId: 'claude',
    issueProviderFilter: 'claude',
    defaultNativeServiceId: CLAUDE_SUBSCRIPTION_CONNECTED_SERVICE_ID,
    fallbackBackoffEnvKey: CLAUDE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_ENV,
    maxAttemptsEnvKey: CLAUDE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS_ENV,
    defaultFallbackBackoffMs: DEFAULT_CLAUDE_USAGE_LIMIT_RECOVERY_FALLBACK_BACKOFF_MS,
    defaultMaxAttempts: DEFAULT_CLAUDE_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS,
    ...deps,
  });
}

export const claudeUsageLimitRecoveryControlAdapter =
  createClaudeUsageLimitRecoveryControlAdapter();
