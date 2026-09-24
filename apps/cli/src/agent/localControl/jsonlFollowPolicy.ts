export type JsonlFollowPolicyV1 = Readonly<{
    activeBurstPollIntervalMs: number;
    activeBurstDurationMs: number;
    activeFallbackPollIntervalMs: number;
    idleFallbackPollIntervalMs: number;
    missingFileRetryIntervalMs: number;
    sidechainCompletionGraceMs: number;
    maxActiveFollowersPerSession: number;
    maxIdleFollowersPerSession: number;
    maxClosedFollowerRecordsPerSession: number;
    maxBufferedSidechainRows: number;
    maxBufferedSidechainBytes: number;
    maxDrainRowsPerTick: number;
    maxDrainBytesPerTick: number;
}>;

export type JsonlFollowPolicyInput = Partial<JsonlFollowPolicyV1>;

export type JsonlFollowPollMode = 'active' | 'idle';

export type JsonlFollowPollState = Readonly<{
    mode: JsonlFollowPollMode;
    elapsedActiveMs: number;
    idlePolls: number;
    lastDrainHadActivity: boolean;
    lastDrainHadError: boolean;
    fileMissing: boolean;
}>;

export const DEFAULT_JSONL_FOLLOW_POLICY: JsonlFollowPolicyV1 = Object.freeze({
    activeBurstPollIntervalMs: 250,
    activeBurstDurationMs: 5_000,
    activeFallbackPollIntervalMs: 1_000,
    idleFallbackPollIntervalMs: 5_000,
    missingFileRetryIntervalMs: 1_000,
    sidechainCompletionGraceMs: 2_000,
    maxActiveFollowersPerSession: 64,
    maxIdleFollowersPerSession: 128,
    maxClosedFollowerRecordsPerSession: 256,
    maxBufferedSidechainRows: 1_000,
    maxBufferedSidechainBytes: 1_048_576,
    maxDrainRowsPerTick: 1_000,
    maxDrainBytesPerTick: 262_144,
});

export function normalizeJsonlFollowPolicy(
    input?: JsonlFollowPolicyInput,
    legacyPollIntervalMs?: number,
): JsonlFollowPolicyV1 {
    const legacyInterval = normalizePositiveInteger(legacyPollIntervalMs, DEFAULT_JSONL_FOLLOW_POLICY.activeBurstPollIntervalMs);
    return Object.freeze({
        activeBurstPollIntervalMs: normalizePositiveInteger(input?.activeBurstPollIntervalMs, legacyInterval),
        activeBurstDurationMs: normalizeNonNegativeInteger(input?.activeBurstDurationMs, DEFAULT_JSONL_FOLLOW_POLICY.activeBurstDurationMs),
        activeFallbackPollIntervalMs: normalizePositiveInteger(input?.activeFallbackPollIntervalMs, DEFAULT_JSONL_FOLLOW_POLICY.activeFallbackPollIntervalMs),
        idleFallbackPollIntervalMs: normalizePositiveInteger(input?.idleFallbackPollIntervalMs, DEFAULT_JSONL_FOLLOW_POLICY.idleFallbackPollIntervalMs),
        missingFileRetryIntervalMs: normalizePositiveInteger(input?.missingFileRetryIntervalMs, DEFAULT_JSONL_FOLLOW_POLICY.missingFileRetryIntervalMs),
        sidechainCompletionGraceMs: normalizeNonNegativeInteger(input?.sidechainCompletionGraceMs, DEFAULT_JSONL_FOLLOW_POLICY.sidechainCompletionGraceMs),
        maxActiveFollowersPerSession: normalizePositiveInteger(input?.maxActiveFollowersPerSession, DEFAULT_JSONL_FOLLOW_POLICY.maxActiveFollowersPerSession),
        maxIdleFollowersPerSession: normalizePositiveInteger(input?.maxIdleFollowersPerSession, DEFAULT_JSONL_FOLLOW_POLICY.maxIdleFollowersPerSession),
        maxClosedFollowerRecordsPerSession: normalizePositiveInteger(input?.maxClosedFollowerRecordsPerSession, DEFAULT_JSONL_FOLLOW_POLICY.maxClosedFollowerRecordsPerSession),
        maxBufferedSidechainRows: normalizePositiveInteger(input?.maxBufferedSidechainRows, DEFAULT_JSONL_FOLLOW_POLICY.maxBufferedSidechainRows),
        maxBufferedSidechainBytes: normalizePositiveInteger(input?.maxBufferedSidechainBytes, DEFAULT_JSONL_FOLLOW_POLICY.maxBufferedSidechainBytes),
        maxDrainRowsPerTick: normalizePositiveInteger(input?.maxDrainRowsPerTick, DEFAULT_JSONL_FOLLOW_POLICY.maxDrainRowsPerTick),
        maxDrainBytesPerTick: normalizePositiveInteger(input?.maxDrainBytesPerTick, DEFAULT_JSONL_FOLLOW_POLICY.maxDrainBytesPerTick),
    });
}

export function resolveJsonlFollowPollDelayMs(policy: JsonlFollowPolicyV1, state: JsonlFollowPollState): number {
    if (state.fileMissing) {
        return policy.missingFileRetryIntervalMs;
    }
    if (state.mode === 'idle') {
        return policy.idleFallbackPollIntervalMs;
    }
    if (state.lastDrainHadActivity || state.elapsedActiveMs < policy.activeBurstDurationMs) {
        return policy.activeBurstPollIntervalMs;
    }
    if (state.idlePolls > 1) {
        return policy.idleFallbackPollIntervalMs;
    }
    if (state.lastDrainHadError) {
        return policy.activeFallbackPollIntervalMs;
    }
    return policy.activeFallbackPollIntervalMs;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}
