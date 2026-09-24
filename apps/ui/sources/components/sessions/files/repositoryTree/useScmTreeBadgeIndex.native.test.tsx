import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installRepositoryTreeCommonModuleMocks } from './repositoryTreeTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installRepositoryTreeCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'ios',
                select: <T,>(options: { ios?: T; native?: T; default?: T; web?: T; android?: T }) =>
                    options.ios ?? options.native ?? options.default ?? options.web ?? options.android,
            },
        });
    },
});

function makeSnapshot() {
    return {
        projectKey: 'p1',
        fetchedAt: 0,
        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
        branch: { head: null, upstream: null, ahead: 0, behind: 0, detached: false },
        hasConflicts: false,
        entries: [
            {
                path: 'src/a.ts',
                previousPath: null,
                kind: 'modified',
                includeStatus: '',
                pendingStatus: '',
                hasIncludedDelta: false,
                hasPendingDelta: true,
                stats: { includedAdded: 0, includedRemoved: 0, pendingAdded: 2, pendingRemoved: 1, isBinary: false },
            },
        ],
        totals: {
            includedFiles: 0,
            pendingFiles: 1,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 2,
            pendingRemoved: 1,
        },
    } as any;
}

describe('useScmTreeBadgeIndex native', () => {
    it('computes the badge index during native render without an effect-driven second render', async () => {
        const { useScmTreeBadgeIndex } = await import('./useScmTreeBadgeIndex');
        const seen: string[] = [];

        function Harness() {
            const index = useScmTreeBadgeIndex(makeSnapshot());
            const badge = index?.getFileBadge('src/a.ts') ?? null;
            const value = badge ? `${badge.kindLetter}:${badge.added}:${badge.removed}` : 'none';
            seen.push(value);
            return React.createElement('Text', { value });
        }

        await renderScreen(<Harness />);

        expect(seen).toEqual(['M:2:1']);
    });
});
