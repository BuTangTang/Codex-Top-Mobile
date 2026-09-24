import { describe, expect, it } from 'vitest';

import { renderHook } from '@/dev/testkit';

import { useSessionRightPanelGitCommitSelection } from './useSessionRightPanelGitCommitSelection';

function makeScmFile(fullPath: string) {
    const segments = fullPath.split('/');
    return {
        fileName: segments.at(-1) || fullPath,
        filePath: segments.slice(0, -1).join('/'),
        fullPath,
        status: 'modified',
        isIncluded: false,
        linesAdded: 1,
        linesRemoved: 0,
    };
}

describe('useSessionRightPanelGitCommitSelection', () => {
    it('counts only visible changed files for atomic commit selection', async () => {
        const hook = await renderHook(() => useSessionRightPanelGitCommitSelection({
            sessionId: 's1',
            sessionPath: '/tmp/repo',
            scmSnapshot: null,
            scmWriteEnabled: true,
            scmCommitStrategy: 'atomic',
            commitSelectionPaths: ['src/visible.ts', 'src/generated/'],
            commitSelectionPatches: [],
            changedFiles: [makeScmFile('src/visible.ts')] as any,
        }));

        expect(hook.getCurrent().repositorySelectedCount).toBe(1);
    });
});
