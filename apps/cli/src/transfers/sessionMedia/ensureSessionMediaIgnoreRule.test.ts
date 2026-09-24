import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { ensureSessionMediaIgnoreRule } from './ensureSessionMediaIgnoreRule';

async function makeWorkspace(prefix: string): Promise<string> {
    const directory = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(directory, { recursive: true });
    return directory;
}

describe('ensureSessionMediaIgnoreRule', () => {
    it('falls back to workspace .gitignore when git_info_exclude is configured but no git directory exists', async () => {
        const workingDirectory = await makeWorkspace('happier-session-media-non-git-exclude');

        await ensureSessionMediaIgnoreRule({
            workingDirectory,
            config: {
                uploadLocation: 'workspace',
                workspaceRelativeDir: '.happier/uploads',
                vcsIgnoreStrategy: 'git_info_exclude',
                vcsIgnoreWritesEnabled: true,
            },
        });

        await expect(readFile(join(workingDirectory, '.gitignore'), 'utf8')).resolves.toContain('/.happier/uploads/');
    });

    it('writes workspace .gitignore for gitignore strategy even when no git directory exists', async () => {
        const workingDirectory = await makeWorkspace('happier-session-media-non-git-gitignore');

        await ensureSessionMediaIgnoreRule({
            workingDirectory,
            config: {
                uploadLocation: 'workspace',
                workspaceRelativeDir: '.happier/uploads',
                vcsIgnoreStrategy: 'gitignore',
                vcsIgnoreWritesEnabled: true,
            },
        });

        await expect(readFile(join(workingDirectory, '.gitignore'), 'utf8')).resolves.toContain('/.happier/uploads/');
    });
});
