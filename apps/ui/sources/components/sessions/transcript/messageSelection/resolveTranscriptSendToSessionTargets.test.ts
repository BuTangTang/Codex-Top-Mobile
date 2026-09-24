import { describe, expect, it, vi } from 'vitest';

import { resolveTranscriptSendToSessionTargets, type TranscriptSendToSessionTargetCandidate } from './resolveTranscriptSendToSessionTargets';

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    const equivalentIds = new Set(['profile-a', 'legacy-a', 'identity-a']);
    return {
        ...original,
        areServerProfileIdentifiersEquivalent: (leftRaw: string | null | undefined, rightRaw: string | null | undefined) => {
            const left = String(leftRaw ?? '').trim();
            const right = String(rightRaw ?? '').trim();
            if (!left || !right) return false;
            if (left === right) return true;
            return equivalentIds.has(left) && equivalentIds.has(right);
        },
        resolveServerProfileScopeIdForIdentifier: (idRaw: string | null | undefined) => {
            const id = String(idRaw ?? '').trim();
            return equivalentIds.has(id) ? 'identity-a' : id;
        },
    };
});

function candidate(input: Partial<TranscriptSendToSessionTargetCandidate> & Pick<TranscriptSendToSessionTargetCandidate, 'id'>): TranscriptSendToSessionTargetCandidate {
    return {
        id: input.id,
        serverId: input.serverId ?? 'server-a',
        accessLevel: input.accessLevel,
        metadata: input.metadata ?? {},
        meaningfulActivityAt: input.meaningfulActivityAt ?? null,
        updatedAt: input.updatedAt ?? 0,
        createdAt: input.createdAt ?? 0,
    };
}

describe('resolveTranscriptSendToSessionTargets', () => {
    it('keeps only same-server writable user-facing destination sessions and excludes the source session', () => {
        const targets = resolveTranscriptSendToSessionTargets({
            sourceSessionId: 'source',
            sourceServerId: 'server-a',
            sessions: [
                candidate({ id: 'source', updatedAt: 50 }),
                candidate({ id: 'writable-edit', accessLevel: 'edit', updatedAt: 40 }),
                candidate({ id: 'writable-owner', accessLevel: undefined, updatedAt: 30 }),
                candidate({ id: 'read-only', accessLevel: 'view', updatedAt: 20 }),
                candidate({ id: 'other-server', serverId: 'server-b', updatedAt: 10 }),
                candidate({ id: 'hidden', metadata: { hiddenSystemSession: true }, updatedAt: 60 }),
            ],
        });

        expect(targets.map((target) => target.id)).toEqual(['writable-edit', 'writable-owner']);
    });

    it('orders destinations by the same stable updated buckets as the session list', () => {
        const fiveMinuteBucketMs = 5 * 60_000;
        const targets = resolveTranscriptSendToSessionTargets({
            sourceSessionId: 'source',
            sourceServerId: 'server-a',
            sessions: [
                candidate({ id: 'older-bucket', meaningfulActivityAt: fiveMinuteBucketMs * 9, updatedAt: 10_000, createdAt: 300 }),
                candidate({ id: 'newer-created', meaningfulActivityAt: fiveMinuteBucketMs * 10 + 1, updatedAt: 100, createdAt: 200 }),
                candidate({ id: 'older-created', meaningfulActivityAt: fiveMinuteBucketMs * 10 + 120_000, updatedAt: 10_100, createdAt: 100 }),
                candidate({ id: 'created-fallback', updatedAt: 0, createdAt: fiveMinuteBucketMs * 11 }),
            ],
        });

        expect(targets.map((target) => target.id)).toEqual([
            'created-fallback',
            'newer-created',
            'older-created',
            'older-bucket',
        ]);
    });

    it('keeps destinations whose server id is equivalent to the source server profile', () => {
        const targets = resolveTranscriptSendToSessionTargets({
            sourceSessionId: 'source',
            sourceServerId: 'profile-a',
            sessions: [
                candidate({ id: 'canonical', serverId: 'identity-a', updatedAt: 30 }),
                candidate({ id: 'legacy', serverId: 'legacy-a', updatedAt: 20 }),
                candidate({ id: 'other', serverId: 'server-b', updatedAt: 10 }),
            ],
        });

        expect(targets.map((target) => target.id)).toEqual(['canonical', 'legacy']);
    });
});
