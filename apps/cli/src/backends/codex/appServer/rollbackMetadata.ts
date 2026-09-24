import type { Metadata } from '@/api/types';
import type {
    SessionRollbackRangeV1,
    SessionRollbackTarget,
} from '@happier-dev/protocol';

type SessionRollbackRangesV1 = {
    v: 1;
    updatedAt: number;
    ranges: SessionRollbackRangeV1[];
};

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readSessionRollbackRangesV1FromMetadata(metadata: unknown): SessionRollbackRangesV1 | null {
    const raw = readRecord(metadata)?.sessionRollbackRangesV1;
    const record = readRecord(raw);
    if (!record || !Array.isArray(record.ranges)) return null;
    return {
        v: 1,
        updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
            ? Math.trunc(record.updatedAt)
            : 0,
        ranges: record.ranges.filter((range): range is SessionRollbackRangeV1 => readRecord(range) !== null),
    };
}

function buildSessionRollbackRangesV1(params: Readonly<{
    updatedAt: number;
    ranges: readonly SessionRollbackRangeV1[];
}>): SessionRollbackRangesV1 {
    return {
        v: 1,
        updatedAt: params.updatedAt,
        ranges: [...params.ranges],
    };
}

type RollbackMetadataSession = Readonly<{
    updateMetadata: (updater: (metadata: Metadata) => Metadata) => Promise<void> | void;
}>;

export type CompletedTurnSeqRange = Readonly<{
    userMessageSeq: number;
    startSeqInclusive: number;
    endSeqInclusive: number;
}>;

export function captureCompletedTurnSeqRange(params: Readonly<{
    userMessageSeq?: number;
    startSeqInclusive: number;
    endSeqInclusive: number;
}>): CompletedTurnSeqRange | null {
    const userMessageSeq = Number.isFinite(params.userMessageSeq) ? Math.trunc(params.userMessageSeq as number) : Math.trunc(params.startSeqInclusive);
    const startSeqInclusive = Number.isFinite(params.startSeqInclusive) ? Math.trunc(params.startSeqInclusive) : -1;
    const endSeqInclusive = Number.isFinite(params.endSeqInclusive) ? Math.trunc(params.endSeqInclusive) : -1;
    if (userMessageSeq < 0 || startSeqInclusive < 0 || endSeqInclusive < startSeqInclusive) {
        return null;
    }
    return { userMessageSeq, startSeqInclusive, endSeqInclusive };
}

export async function publishRollbackRangeMetadata(params: Readonly<{
    session: RollbackMetadataSession;
    target: SessionRollbackTarget;
    range: CompletedTurnSeqRange;
    rolledBackAt?: number;
}>): Promise<void> {
    const rolledBackAt = typeof params.rolledBackAt === 'number' && Number.isFinite(params.rolledBackAt)
        ? Math.trunc(params.rolledBackAt)
        : Date.now();

    await Promise.resolve(params.session.updateMetadata((metadata) => {
        const existing = readSessionRollbackRangesV1FromMetadata(metadata);
        const nextRange: SessionRollbackRangeV1 = {
            target: params.target,
            startSeqInclusive: params.range.startSeqInclusive,
            endSeqInclusive: params.range.endSeqInclusive,
            rolledBackAt,
        };
        return {
            ...metadata,
            sessionRollbackRangesV1: buildSessionRollbackRangesV1({
                updatedAt: rolledBackAt,
                ranges: [...(existing?.ranges ?? []), nextRange],
            }),
        };
    }));
}

export async function publishLatestTurnRollbackRangeMetadata(params: Readonly<{
    session: RollbackMetadataSession;
    range: CompletedTurnSeqRange;
    rolledBackAt?: number;
}>): Promise<void> {
    await publishRollbackRangeMetadata({
        session: params.session,
        target: { type: 'latest_turn' },
        range: params.range,
        ...(typeof params.rolledBackAt === 'number' ? { rolledBackAt: params.rolledBackAt } : {}),
    });
}
