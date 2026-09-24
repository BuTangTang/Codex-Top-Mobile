import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { readDesktopProjects } from './readDesktopProjects';

describe('Desktop saved projects', () => {
    it('returns genuine saved project ids in desktop order and marks unavailable roots', async () => {
        const root = await createTempDir('desktop-projects-');
        try {
            await mkdir(join(root, 'project'));
            await writeFile(join(root, '.codex-global-state.json'), JSON.stringify({
                'local-projects': {
                    alpha: { id: 'alpha', name: 'Synthetic alpha', rootPaths: [join(root, 'project')], createdAt: 1, updatedAt: 1 },
                    beta: { id: 'beta', name: 'Synthetic beta', rootPaths: [join(root, 'missing')], createdAt: 2, updatedAt: 2 },
                }, 'project-order': ['beta', 'alpha'], 'electron-saved-workspace-roots': ['/do-not-invent-a-project'],
            }));
            expect(await readDesktopProjects(root)).toEqual([
                { id: 'beta', name: 'Synthetic beta', rootPaths: [join(root, 'missing')], available: false, unavailableReason: 'project_root_unavailable' },
                { id: 'alpha', name: 'Synthetic alpha', rootPaths: [join(root, 'project')], available: true },
            ]);
        } finally { await removeTempDir(root); }
    });
    it('does not turn missing or invalid desktop configuration into an empty successful list', async () => {
        const root = await createTempDir('desktop-projects-');
        try {
            await expect(readDesktopProjects(root)).rejects.toThrow('desktop_projects_unavailable');
            await writeFile(join(root, '.codex-global-state.json'), JSON.stringify({ 'local-projects': { broken: { id: 'different' } } }));
            await expect(readDesktopProjects(root)).rejects.toThrow('desktop_projects_invalid');
        } finally { await removeTempDir(root); }
    });
});
