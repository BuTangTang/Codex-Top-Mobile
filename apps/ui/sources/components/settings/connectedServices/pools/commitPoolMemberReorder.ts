import { isConnectedServiceApiErrorCode } from '@/sync/api/account/connectedServiceApiError';

/** Spacing between adjacent member priorities (lower priority wins = earlier fallback). */
export const POOL_MEMBER_PRIORITY_STEP = 100;

const DEFAULT_MAX_CONFLICT_RETRIES = 3;

export type ReorderableMember = Readonly<{ profileId: string; priority: number }>;

export type ReorderableGroup = Readonly<{
    generation: number;
    members: ReadonlyArray<ReorderableMember>;
}>;

export type PoolMemberPriorityChange = Readonly<{ profileId: string; priority: number }>;

/**
 * Maps an ordered list of member profile ids to spaced priorities. Only ids
 * present in the group's members are indexed (stray ids are ignored) so real
 * members always receive contiguous, gap-free priorities.
 */
export function computePoolMemberPriorities(
    orderedProfileIds: ReadonlyArray<string>,
    presentProfileIds: ReadonlySet<string>,
    step: number = POOL_MEMBER_PRIORITY_STEP,
): Map<string, number> {
    const priorities = new Map<string, number>();
    let index = 0;
    for (const profileId of orderedProfileIds) {
        if (!presentProfileIds.has(profileId)) continue;
        priorities.set(profileId, (index + 1) * step);
        index += 1;
    }
    return priorities;
}

/**
 * Resolves the minimal set of priority changes needed to realize the new order:
 * only members whose target priority differs from their current priority.
 */
export function resolvePoolMemberPriorityChanges(
    members: ReadonlyArray<ReorderableMember>,
    orderedProfileIds: ReadonlyArray<string>,
    step: number = POOL_MEMBER_PRIORITY_STEP,
): PoolMemberPriorityChange[] {
    const currentByProfile = new Map(members.map((member) => [member.profileId, member.priority] as const));
    const presentProfileIds = new Set(currentByProfile.keys());
    const targetPriorities = computePoolMemberPriorities(orderedProfileIds, presentProfileIds, step);

    const changes: PoolMemberPriorityChange[] = [];
    for (const [profileId, priority] of targetPriorities) {
        if (currentByProfile.get(profileId) !== priority) {
            changes.push({ profileId, priority });
        }
    }
    return changes;
}

export type CommitPoolMemberReorderParams = Readonly<{
    /** The authoritative group at drag-start (carries `generation` + `members`). */
    group: ReorderableGroup;
    /** The new fallback order as member profile ids. */
    orderedProfileIds: ReadonlyArray<string>;
    /**
     * Boundary: patches a single member's priority. Must return the updated group
     * so the bumped `generation` can be threaded into the next patch. Wire this to
     * `patchConnectedServiceAuthGroupMemberV3({ patch: { priority, expectedGeneration } })`.
     */
    patchMember: (input: Readonly<{
        profileId: string;
        priority: number;
        expectedGeneration: number;
    }>) => Promise<ReorderableGroup>;
    /** Boundary: refetches the authoritative group after a generation conflict. */
    refetchGroup: () => Promise<ReorderableGroup>;
    priorityStep?: number;
    maxConflictRetries?: number;
}>;

export type CommitPoolMemberReorderResult = Readonly<{
    group: ReorderableGroup;
    patchedProfileIds: ReadonlyArray<string>;
    conflictRetryCount: number;
}>;

/**
 * Commits a pool member reorder by reindexing `members[].priority` and patching
 * only the changed members SEQUENTIALLY, threading the bumped `expectedGeneration`
 * returned by each patch (there is no batch endpoint, so sequential is the only
 * safe path). On `connect_group_generation_conflict` it refetches the group and
 * retries the (recomputed) remaining changes, up to `maxConflictRetries`.
 */
export async function commitPoolMemberReorder(
    params: CommitPoolMemberReorderParams,
): Promise<CommitPoolMemberReorderResult> {
    const step = params.priorityStep ?? POOL_MEMBER_PRIORITY_STEP;
    const maxConflictRetries = params.maxConflictRetries ?? DEFAULT_MAX_CONFLICT_RETRIES;

    let group = params.group;
    let conflictRetryCount = 0;

    for (let attempt = 0; ; attempt += 1) {
        const changes = resolvePoolMemberPriorityChanges(group.members, params.orderedProfileIds, step);
        const patchedProfileIds: string[] = [];
        try {
            let generation = group.generation;
            for (const change of changes) {
                const updated = await params.patchMember({
                    profileId: change.profileId,
                    priority: change.priority,
                    expectedGeneration: generation,
                });
                generation = updated.generation;
                group = updated;
                patchedProfileIds.push(change.profileId);
            }
            return { group, patchedProfileIds, conflictRetryCount };
        } catch (error) {
            const isConflict = isConnectedServiceApiErrorCode(error, 'connect_group_generation_conflict');
            if (isConflict && attempt < maxConflictRetries) {
                conflictRetryCount += 1;
                group = await params.refetchGroup();
                continue;
            }
            throw error;
        }
    }
}
