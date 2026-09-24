import { describe, expect, it } from 'vitest';

import { resolveNextOptimisticAcpConfigOptionOverrides } from './resolveNextOptimisticAcpConfigOptionOverrides';

type Overrides = Readonly<{
    v: 1;
    updatedAt: number;
    overrides: Readonly<Record<string, Readonly<{ updatedAt: number; value: string }>>>;
}>;

describe('resolveNextOptimisticAcpConfigOptionOverrides', () => {
    it('keeps the current optimistic object when the server snapshot is semantically identical', () => {
        const current: Overrides = {
            v: 1,
            updatedAt: 42,
            overrides: {
                thinking: {
                    updatedAt: 42,
                    value: 'high',
                },
            },
        };
        const incoming: Overrides = {
            v: 1,
            updatedAt: 42,
            overrides: {
                thinking: {
                    updatedAt: 42,
                    value: 'high',
                },
            },
        };

        expect(resolveNextOptimisticAcpConfigOptionOverrides({
            current,
            incoming,
            sessionChanged: false,
        })).toBe(current);
    });

    it('adopts the incoming server snapshot when it is newer than the optimistic state', () => {
        const current: Overrides = {
            v: 1,
            updatedAt: 42,
            overrides: {
                thinking: {
                    updatedAt: 42,
                    value: 'medium',
                },
            },
        };
        const incoming: Overrides = {
            v: 1,
            updatedAt: 50,
            overrides: {
                thinking: {
                    updatedAt: 50,
                    value: 'high',
                },
            },
        };

        expect(resolveNextOptimisticAcpConfigOptionOverrides({
            current,
            incoming,
            sessionChanged: false,
        })).toBe(incoming);
    });

    it('preserves the optimistic state when the server snapshot is older or missing', () => {
        const current: Overrides = {
            v: 1,
            updatedAt: 42,
            overrides: {
                thinking: {
                    updatedAt: 42,
                    value: 'high',
                },
            },
        };
        const olderIncoming: Overrides = {
            v: 1,
            updatedAt: 40,
            overrides: {
                thinking: {
                    updatedAt: 40,
                    value: 'medium',
                },
            },
        };

        expect(resolveNextOptimisticAcpConfigOptionOverrides({
            current,
            incoming: olderIncoming,
            sessionChanged: false,
        })).toBe(current);
        expect(resolveNextOptimisticAcpConfigOptionOverrides({
            current,
            incoming: null,
            sessionChanged: false,
        })).toBe(current);
    });
});
