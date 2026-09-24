import type { UsageData } from './schemas';

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function readNonNegativeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function readTokenCountNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
    for (const key of keys) {
        const value = readNonNegativeInteger(record[key]);
        if (value !== null) return value;
    }
    return null;
}

function readContextWindowTokens(record: Record<string, unknown>): number | null {
    return readTokenCountNumber(record, [
        'context_window_tokens',
        'contextWindowTokens',
        'contextWindow',
        'context_window',
        'size',
    ]);
}

function readContextUsedTokens(record: Record<string, unknown>): number | null {
    return readTokenCountNumber(record, [
        'context_used_tokens',
        'contextUsedTokens',
        'used',
    ]);
}

function buildUsageDataFromTokenRecord(record: Record<string, unknown>): UsageData | null {
    const input =
        readTokenCountNumber(record, ['input', 'input_tokens', 'prompt_tokens']) ??
        readTokenCountNumber(record, ['used']);
    const output = readTokenCountNumber(record, ['output', 'output_tokens', 'completion_tokens']);
    const cacheRead = readTokenCountNumber(record, ['cache_read', 'cache_read_input_tokens', 'cached_read']);
    const cacheCreation = readTokenCountNumber(record, ['cache_creation', 'cache_creation_input_tokens', 'cache_write', 'cached_write']);

    const hasAnyValue = input !== null || output !== null || cacheRead !== null || cacheCreation !== null;
    if (!hasAnyValue) return null;

    return {
        input_tokens: input ?? 0,
        output_tokens: output ?? 0,
        ...(cacheRead !== null ? { cache_read_input_tokens: cacheRead } : {}),
        ...(cacheCreation !== null ? { cache_creation_input_tokens: cacheCreation } : {}),
    };
}

export function buildUsageDataFromTokenCountMessage(raw: unknown): UsageData | null {
    const record = asRecord(raw);
    if (!record) return null;

    const nestedTokens = asRecord(record.tokens);
    const usage = nestedTokens
        ? (buildUsageDataFromTokenRecord(nestedTokens) ?? buildUsageDataFromTokenRecord(record))
        : buildUsageDataFromTokenRecord(record);
    if (!usage) return null;

    const contextUsedTokens = readContextUsedTokens(record) ?? (nestedTokens ? readContextUsedTokens(nestedTokens) : null);
    const contextWindowTokens = readContextWindowTokens(record) ?? (nestedTokens ? readContextWindowTokens(nestedTokens) : null);

    return {
        ...usage,
        ...(contextUsedTokens !== null ? { context_used_tokens: contextUsedTokens } : {}),
        ...(contextWindowTokens !== null ? { context_window_tokens: contextWindowTokens } : {}),
    };
}
