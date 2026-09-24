import {
  resolveRecoverableTurnFailureRetryDecision,
  type RecoverableTurnFailureRetryDecision,
} from '@/agent/runtime/session/recoverableTurnFailurePolicy';

export type ClaudeRuntimeAuthRetryDecision =
  | Extract<RecoverableTurnFailureRetryDecision, { action: 'await_provider_retry' }>
  | Readonly<{
      action: 'surface';
    }>;

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function readPositiveInt(value: unknown): number | null {
  const parsed = readFiniteNumber(value);
  if (parsed === null || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function readNonNegativeInt(value: unknown): number | null {
  const parsed = readFiniteNumber(value);
  if (parsed === null || parsed < 0) return null;
  return Math.trunc(parsed);
}

function readProviderWillRetry(record: Readonly<Record<string, unknown>>): boolean {
  if (record.willRetry === true || record.will_retry === true) return true;
  const attempt = readPositiveInt(record.attempt ?? record.retryAttempt ?? record.retry_attempt);
  const maxRetries = readPositiveInt(record.max_retries ?? record.maxRetries ?? record.maxRetryAttempts);
  if (attempt === null || maxRetries === null) return false;
  return attempt < maxRetries;
}

function readFailureRetryAfterMs(record: Readonly<Record<string, unknown>>): number | null {
  return readNonNegativeInt(
    record.retry_delay_ms
      ?? record.retryDelayMs
      ?? record.retry_after_ms
      ?? record.retryAfterMs,
  );
}

export function resolveClaudeRuntimeAuthRetryDecision(error: unknown): ClaudeRuntimeAuthRetryDecision {
  const record = readRecord(error);
  if (!record || !readProviderWillRetry(record)) return { action: 'surface' };
  const decision = resolveRecoverableTurnFailureRetryDecision({
    attemptCount: 0,
    maxRetries: 0,
    providerWillRetry: true,
    failureRetryAfterMs: readFailureRetryAfterMs(record),
    failedTurnHadMeaningfulActivity: false,
    promptMode: 'off',
    originalPrompt: '',
    continuationPrompt: '',
  });
  return decision.action === 'await_provider_retry' ? decision : { action: 'surface' };
}
