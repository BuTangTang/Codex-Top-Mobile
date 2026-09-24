import {
  parseCompactDurationMs,
  parseProviderTimestampMs,
  parseRetryAfterHeader,
  type ProviderResetTiming,
} from './parseRetryAfterHeader';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readCaseInsensitive(record: Record<string, unknown> | null, name: string): unknown {
  if (!record) return undefined;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === expected) return value;
  }
  return undefined;
}

function timingFromDuration(value: unknown, nowMs: number): ProviderResetTiming | null {
  const durationMs = parseCompactDurationMs(value);
  return durationMs === null ? null : { retryAfterMs: durationMs, resetAtMs: nowMs + durationMs };
}

function timingFromSeconds(value: unknown, nowMs: number): ProviderResetTiming | null {
  const text = normalizeString(value);
  const numeric = typeof value === 'number' ? value : text === null ? Number.NaN : Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const durationMs = Math.trunc(numeric * 1_000);
  return { retryAfterMs: durationMs, resetAtMs: nowMs + durationMs };
}

function timingFromMilliseconds(value: unknown): ProviderResetTiming | null {
  const text = normalizeString(value);
  const numeric = typeof value === 'number' ? value : text === null ? Number.NaN : Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return { retryAfterMs: Math.trunc(numeric), resetAtMs: null };
}

function timingFromTimestamp(value: unknown, nowMs: number): ProviderResetTiming | null {
  const resetAtMs = parseProviderTimestampMs(value);
  return resetAtMs === null ? null : { retryAfterMs: Math.max(0, resetAtMs - nowMs), resetAtMs };
}

function readZonedParts(dateMs: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(dateMs));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = Number(values.get('year'));
    const month = Number(values.get('month'));
    const day = Number(values.get('day'));
    const hour = Number(values.get('hour'));
    const minute = Number(values.get('minute'));
    if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
    return { year, month, day, hour, minute };
  } catch {
    return null;
  }
}

function zonedLocalDateTimeToUtcMs(params: Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}>): number | null {
  const desiredAsUtc = Date.UTC(params.year, params.month - 1, params.day, params.hour, params.minute, 0, 0);
  const observed = readZonedParts(desiredAsUtc, params.timeZone);
  if (!observed) return null;
  const observedAsUtc = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    0,
    0,
  );
  return desiredAsUtc + (desiredAsUtc - observedAsUtc);
}

function parseMonthName(value: string | undefined): number | null {
  if (!value) return null;
  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const index = months.findIndex((month) => month.startsWith(value.toLowerCase()));
  return index >= 0 ? index + 1 : null;
}

function parseClock(hourText: string, minuteText: string | undefined, meridiemText: string): { hour: number; minute: number } | null {
  const hour12 = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const meridiem = meridiemText.toLowerCase();
  const hour = meridiem === 'pm' ? (hour12 % 12) + 12 : hour12 % 12;
  return { hour, minute };
}

function timingFromClaudeTuiResetText(text: string, nowMs: number): ProviderResetTiming | null {
  const match = /\b(?:resets?)\s+(?:(?:([A-Z][a-z]+)\s+(\d{1,2})\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm))\s*\(([^)]+)\)/iu.exec(text);
  if (!match) return null;
  const clock = parseClock(match[3] ?? '', match[4], match[5] ?? '');
  if (!clock) return null;
  const timeZone = match[6]?.trim();
  if (!timeZone) return null;

  const nowParts = readZonedParts(nowMs, timeZone);
  if (!nowParts) return null;
  const explicitMonth = parseMonthName(match[1]);
  const explicitDay = match[2] ? Number(match[2]) : null;
  const base = {
    year: nowParts.year,
    month: explicitMonth ?? nowParts.month,
    day: explicitDay && Number.isInteger(explicitDay) ? explicitDay : nowParts.day,
    hour: clock.hour,
    minute: clock.minute,
    timeZone,
  };
  let resetAtMs = zonedLocalDateTimeToUtcMs(base);
  if (resetAtMs === null) return null;
  if (resetAtMs < nowMs && !explicitMonth && !explicitDay) {
    resetAtMs = zonedLocalDateTimeToUtcMs({
      ...base,
      day: base.day + 1,
    });
  }
  return resetAtMs === null ? null : { retryAfterMs: Math.max(0, resetAtMs - nowMs), resetAtMs };
}

function extractResetDelayText(value: unknown): string | null {
  const text = normalizeString(value);
  if (!text) return null;
  const match = /\b(?:reset|resets|retry|try again)\s+(?:after|in)\s+([0-9][0-9a-zA-Z.\s]*)/iu.exec(text);
  return match?.[1]?.trim() ?? null;
}

function collectStringCandidates(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringCandidates(item, output);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of ['message', 'detail', 'details', 'error', 'description']) {
    collectStringCandidates(value[key], output);
  }
}

export function parseProviderResetAt(input: Readonly<{
  nowMs: number;
  headers?: unknown;
  body?: unknown;
}>): ProviderResetTiming {
  const headers = isRecord(input.headers) ? input.headers : null;
  const body = isRecord(input.body) ? input.body : null;
  const retryAfterMs = readCaseInsensitive(headers, 'retry-after-ms')
    ?? body?.['retry-after-ms']
    ?? body?.retryAfterMs;
  const retryAfterMsTiming = timingFromMilliseconds(retryAfterMs) ?? timingFromDuration(retryAfterMs, input.nowMs);
  if (retryAfterMsTiming) return retryAfterMsTiming;

  const retryAfter = parseRetryAfterHeader(readCaseInsensitive(headers, 'retry-after') ?? body?.['retry-after'], {
    nowMs: input.nowMs,
  });
  if (retryAfter.retryAfterMs !== null || retryAfter.resetAtMs !== null) return retryAfter;

  for (const value of [
    readCaseInsensitive(headers, 'x-ratelimit-reset-after'),
    body?.quotaResetDelay,
    body?.retryDelay,
    body?.retry_delay,
  ]) {
    const timing = timingFromDuration(value, input.nowMs) ?? timingFromSeconds(value, input.nowMs);
    if (timing) return timing;
  }

  for (const value of [
    readCaseInsensitive(headers, 'x-ratelimit-reset'),
    readCaseInsensitive(headers, 'anthropic-ratelimit-tokens-reset'),
    readCaseInsensitive(headers, 'anthropic-ratelimit-requests-reset'),
    readCaseInsensitive(headers, 'anthropic-ratelimit-input-tokens-reset'),
    readCaseInsensitive(headers, 'anthropic-ratelimit-output-tokens-reset'),
    body?.quotaResetTimeStamp,
    body?.quotaResetTimestamp,
    body?.quota_reset_timestamp,
    body?.resetTime,
    body?.reset_time,
    body?.resetsAt,
    body?.resets_at,
    body?.resetAt,
    body?.reset_at,
  ]) {
    const timing = timingFromTimestamp(value, input.nowMs);
    if (timing) return timing;
  }

  const textCandidates: string[] = [];
  collectStringCandidates(input.body, textCandidates);
  for (const candidate of textCandidates) {
    const tuiResetTiming = timingFromClaudeTuiResetText(candidate, input.nowMs);
    if (tuiResetTiming) return tuiResetTiming;
    const timing = timingFromDuration(extractResetDelayText(candidate), input.nowMs);
    if (timing) return timing;
    const timestamp = timingFromTimestamp(candidate, input.nowMs);
    if (timestamp) return timestamp;
  }

  return { retryAfterMs: null, resetAtMs: null };
}
