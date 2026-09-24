import { describe, expect, it, vi } from 'vitest';

import { ConnectedServiceApiError } from '@/sync/api/account/connectedServiceApiError';
import {
    type ReorderableGroup,
    type ReorderableMember,
    commitPoolMemberReorder,
    computePoolMemberPriorities,
    resolvePoolMemberPriorityChanges,
} from './commitPoolMemberReorder';

function member(profileId: string, priority: number): ReorderableMember {
    return { profileId, priority };
}

function group(generation: number, members: ReadonlyArray<ReorderableMember>): ReorderableGroup {
    return { generation, members };
}

const conflictError = () => new ConnectedServiceApiError({ code: 'connect_group_generation_conflict' });

describe('resolvePoolMemberPriorityChanges', () => {
    it('assigns spaced contiguous priorities and returns only changed members', () => {
        // a,b,c currently 100,200,300; reorder to c,a,b.
        const members = [member('a', 100), member('b', 200), member('c', 300)];
        const changes = resolvePoolMemberPriorityChanges(members, ['c', 'a', 'b'], 100);

        expect(changes).toEqual([
            { profileId: 'c', priority: 100 },
            { profileId: 'a', priority: 200 },
            { profileId: 'b', priority: 300 },
        ]);
    });

    it('returns no changes when the order already matches the spaced priorities', () => {
        const members = [member('a', 100), member('b', 200)];
        expect(resolvePoolMemberPriorityChanges(members, ['a', 'b'], 100)).toEqual([]);
    });

    it('ignores ids that are not present members (no gaps for real members)', () => {
        const members = [member('a', 100), member('b', 200)];
        const present = new Set(members.map((m) => m.profileId));

        // The stray "ghost" id does not consume a priority slot.
        const priorities = computePoolMemberPriorities(['ghost', 'b', 'a'], present, 100);
        expect(priorities.size).toBe(2);
        expect(priorities.get('b')).toBe(100);
        expect(priorities.get('a')).toBe(200);

        const changes = resolvePoolMemberPriorityChanges(members, ['ghost', 'b', 'a'], 100);
        expect(changes).toEqual([
            { profileId: 'b', priority: 100 },
            { profileId: 'a', priority: 200 },
        ]);
    });
});

describe('commitPoolMemberReorder', () => {
    it('patches only changed members sequentially, threading the bumped generation', async () => {
        const initial = group(5, [member('a', 100), member('b', 200), member('c', 300)]);
        const patchCalls: Array<{ profileId: string; priority: number; expectedGeneration: number }> = [];

        let generation = initial.generation;
        const patchMember = vi.fn(async (input: { profileId: string; priority: number; expectedGeneration: number }) => {
            patchCalls.push(input);
            generation += 1;
            return group(generation, initial.members);
        });
        const refetchGroup = vi.fn(async () => initial);

        const result = await commitPoolMemberReorder({
            group: initial,
            orderedProfileIds: ['c', 'a', 'b'],
            patchMember,
            refetchGroup,
        });

        // generation threaded: 5 → 6 → 7.
        expect(patchCalls).toEqual([
            { profileId: 'c', priority: 100, expectedGeneration: 5 },
            { profileId: 'a', priority: 200, expectedGeneration: 6 },
            { profileId: 'b', priority: 300, expectedGeneration: 7 },
        ]);
        expect(result.patchedProfileIds).toEqual(['c', 'a', 'b']);
        expect(result.group.generation).toBe(8);
        expect(result.conflictRetryCount).toBe(0);
        expect(refetchGroup).not.toHaveBeenCalled();
    });

    it('does not patch when the order is unchanged', async () => {
        const initial = group(5, [member('a', 100), member('b', 200)]);
        const patchMember = vi.fn(async () => initial);
        const refetchGroup = vi.fn(async () => initial);

        const result = await commitPoolMemberReorder({
            group: initial,
            orderedProfileIds: ['a', 'b'],
            patchMember,
            refetchGroup,
        });

        expect(patchMember).not.toHaveBeenCalled();
        expect(result.patchedProfileIds).toEqual([]);
    });

    it('refetches and retries on a generation conflict', async () => {
        const initial = group(5, [member('a', 100), member('b', 200)]);
        // After conflict the server is at generation 9 with the same members.
        const refreshed = group(9, [member('a', 100), member('b', 200)]);

        let generation = refreshed.generation;
        const patchMember = vi
            .fn<(input: { profileId: string; priority: number; expectedGeneration: number }) => Promise<ReorderableGroup>>()
            .mockImplementationOnce(async () => {
                throw conflictError();
            })
            .mockImplementation(async (input) => {
                expect(input.expectedGeneration).toBe(generation);
                generation += 1;
                return group(generation, refreshed.members);
            });
        const refetchGroup = vi.fn(async () => refreshed);

        const result = await commitPoolMemberReorder({
            group: initial,
            orderedProfileIds: ['b', 'a'],
            patchMember,
            refetchGroup,
        });

        expect(refetchGroup).toHaveBeenCalledTimes(1);
        expect(result.conflictRetryCount).toBe(1);
        // Final attempt patched both members against the refreshed generation.
        expect(result.patchedProfileIds).toEqual(['b', 'a']);
        expect(result.group.generation).toBe(11);
    });

    it('propagates non-conflict errors without retrying', async () => {
        const initial = group(5, [member('a', 100), member('b', 200)]);
        const patchMember = vi.fn(async () => {
            throw new Error('network down');
        });
        const refetchGroup = vi.fn(async () => initial);

        await expect(
            commitPoolMemberReorder({
                group: initial,
                orderedProfileIds: ['b', 'a'],
                patchMember,
                refetchGroup,
            }),
        ).rejects.toThrow('network down');
        expect(refetchGroup).not.toHaveBeenCalled();
    });

    it('gives up after exhausting the conflict-retry budget', async () => {
        const initial = group(5, [member('a', 100), member('b', 200)]);
        const patchMember = vi.fn(async () => {
            throw conflictError();
        });
        const refetchGroup = vi.fn(async () => initial);

        await expect(
            commitPoolMemberReorder({
                group: initial,
                orderedProfileIds: ['b', 'a'],
                patchMember,
                refetchGroup,
                maxConflictRetries: 2,
            }),
        ).rejects.toBeInstanceOf(ConnectedServiceApiError);
        // 2 retries → refetched twice (attempts 0,1,2 = 3 patch attempts).
        expect(refetchGroup).toHaveBeenCalledTimes(2);
        expect(patchMember).toHaveBeenCalledTimes(3);
    });
});
