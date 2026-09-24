function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

export function normalizeContextWindowTokens(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.trunc(value);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.trunc(parsed);
        }
    }

    return undefined;
}

function readFirstContextWindowCandidate(
    record: Record<string, unknown> | null,
    keys: readonly string[],
): number | undefined {
    if (!record) return undefined;
    for (const key of keys) {
        const normalized = normalizeContextWindowTokens(record[key]);
        if (normalized !== undefined) return normalized;
    }
    return undefined;
}

export function readContextWindowTokensFromModelRecord(record: Record<string, unknown>): number | undefined {
    const direct = readFirstContextWindowCandidate(record, [
        'contextWindowTokens',
        'context_window_tokens',
        'contextWindow',
        'context_window',
    ]);
    if (direct !== undefined) return direct;

    const limit = asRecord(record.limit);
    const nestedLimit = readFirstContextWindowCandidate(limit, [
        'context',
        'context_window',
        'contextWindow',
        'contextWindowTokens',
        'context_window_tokens',
    ]);
    if (nestedLimit !== undefined) return nestedLimit;

    const capabilities = asRecord(record.capabilities);
    const nestedCapabilities = readFirstContextWindowCandidate(capabilities, [
        'contextWindowTokens',
        'context_window_tokens',
        'contextWindow',
        'context_window',
        'maxInputTokens',
        'max_input_tokens',
        'inputTokenLimit',
        'input_token_limit',
    ]);
    if (nestedCapabilities !== undefined) return nestedCapabilities;

    const inputCapabilities = asRecord(capabilities?.input);
    return readFirstContextWindowCandidate(inputCapabilities, [
        'contextWindowTokens',
        'context_window_tokens',
        'contextWindow',
        'context_window',
        'maxTokens',
        'max_tokens',
        'maxInputTokens',
        'max_input_tokens',
        'tokenLimit',
        'token_limit',
    ]);
}
