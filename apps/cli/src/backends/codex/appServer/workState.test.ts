import { describe, expect, it } from 'vitest';

import {
    mergeCodexGoalIntoSessionWorkStateMetadata,
    removeCodexGoalFromSessionWorkStateMetadata,
} from './workState';

describe('workState', () => {
    it('merges Codex goal into sessionWorkStateV1 while preserving other metadata and future items', () => {
        const next = mergeCodexGoalIntoSessionWorkStateMetadata(
            {
                machineId: 'machine-1',
                sessionWorkStateV1: {
                    v: 1,
                    backendId: 'codex',
                    updatedAt: 1,
                    primaryItemId: 'todo:future',
                    items: [
                        { id: 'todo:future', kind: 'todo', origin: 'vendor', status: 'active', title: 'Other worker', updatedAt: 1 },
                        { id: 'goal:codex:old', kind: 'goal', origin: 'vendor', status: 'active', title: 'Old', updatedAt: 1 },
                    ],
                },
            },
            {
                threadId: 'thread-1',
                objective: 'Ship plugin support',
                status: 'complete',
                updatedAt: '2026-05-13T12:00:00.000Z',
            },
        );

        expect(next).toMatchObject({
            machineId: 'machine-1',
            sessionWorkStateV1: {
                v: 1,
                backendId: 'codex',
                updatedAt: Date.parse('2026-05-13T12:00:00.000Z'),
                primaryItemId: 'todo:future',
                items: [
                    { id: 'todo:future', kind: 'todo', origin: 'vendor', status: 'active', title: 'Other worker', updatedAt: 1 },
                    {
                        id: 'goal:thread-1',
                        kind: 'goal',
                        origin: 'vendor',
                        status: 'complete',
                        title: 'Ship plugin support',
                        backendId: 'codex',
                        vendorRef: 'thread-1',
                        updatedAt: Date.parse('2026-05-13T12:00:00.000Z'),
                    },
                ],
            },
        });
    });

    it('sets the Codex goal as primary when no active task or todo exists', () => {
        const next = mergeCodexGoalIntoSessionWorkStateMetadata(
            {
                sessionWorkStateV1: {
                    v: 1,
                    backendId: 'codex',
                    updatedAt: 1,
                    items: [{ id: 'goal:other', kind: 'goal', origin: 'vendor', status: 'active', title: 'Future', updatedAt: 1 }],
                },
            },
            {
                threadId: 'thread-1',
                objective: 'Keep focus',
                status: 'active',
                updatedAt: 2,
            },
        );

        expect((next.sessionWorkStateV1 as { primaryItemId?: unknown }).primaryItemId).toBe('goal:thread-1');
    });

    it('replaces stale modern Codex goal items when a new goal snapshot arrives', () => {
        const next = mergeCodexGoalIntoSessionWorkStateMetadata(
            {
                sessionWorkStateV1: {
                    v: 1,
                    backendId: 'codex',
                    updatedAt: 1,
                    primaryItemId: 'goal:thread-old',
                    items: [
                        {
                            id: 'goal:thread-old',
                            kind: 'goal',
                            origin: 'vendor',
                            backendId: 'codex',
                            vendorRef: 'thread-old',
                            status: 'active',
                            title: 'Old goal',
                            updatedAt: 1,
                        },
                        {
                            id: 'todo:opencode:1',
                            kind: 'todo',
                            origin: 'vendor',
                            backendId: 'opencode',
                            status: 'active',
                            title: 'Other provider todo',
                            updatedAt: 1,
                        },
                    ],
                },
            },
            {
                threadId: 'thread-new',
                objective: 'New goal',
                status: 'active',
                updatedAt: 2,
            },
        );

        expect(next.sessionWorkStateV1.items.map((item) => item.id)).toEqual([
            'todo:opencode:1',
            'goal:thread-new',
        ]);
        expect(next.sessionWorkStateV1.primaryItemId).toBe('todo:opencode:1');
    });

    it('clears only Codex-owned goal items from sessionWorkStateV1', () => {
        expect(removeCodexGoalFromSessionWorkStateMetadata({
            sessionWorkStateV1: {
                v: 1,
                backendId: 'codex',
                updatedAt: 10,
                primaryItemId: 'goal:thread-1',
                items: [
                    { id: 'goal:thread-1', kind: 'goal', origin: 'vendor', backendId: 'codex', vendorRef: 'thread-1', status: 'active', title: 'Codex', updatedAt: 9 },
                    { id: 'goal:other', kind: 'goal', origin: 'vendor', backendId: 'other', vendorRef: 'thread-2', status: 'active', title: 'Other goal', updatedAt: 8 },
                    { id: 'todo:future', kind: 'todo', origin: 'vendor', status: 'active', title: 'Other worker', updatedAt: 1 },
                ],
            },
        })).toEqual({
            sessionWorkStateV1: {
                v: 1,
                backendId: 'codex',
                updatedAt: 10,
                primaryItemId: 'todo:future',
                items: [
                    { id: 'goal:other', kind: 'goal', origin: 'vendor', backendId: 'other', vendorRef: 'thread-2', status: 'active', title: 'Other goal', updatedAt: 8 },
                    { id: 'todo:future', kind: 'todo', origin: 'vendor', status: 'active', title: 'Other worker', updatedAt: 1 },
                ],
            },
        });
    });
});
