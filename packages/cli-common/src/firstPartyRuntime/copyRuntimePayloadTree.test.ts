import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { replaceRuntimePayloadTree } from './copyRuntimePayloadTree';

describe('replaceRuntimePayloadTree', () => {
    it('skips AppleDouble files and nested node_modules/.bin shims', async () => {
        const workspace = await mkdtemp(join(tmpdir(), 'happier-copy-runtime-payload-tree-'));
        const sourcePath = join(workspace, 'source');
        const destinationPath = join(workspace, 'dest');

        await mkdir(join(sourcePath, 'package-dist'), { recursive: true });
        await mkdir(join(sourcePath, 'node_modules', 'example', 'node_modules', '.bin'), { recursive: true });
        await writeFile(join(sourcePath, 'happier.exe'), 'runtime-binary', 'utf8');
        await writeFile(join(sourcePath, 'package-dist', 'index.mjs'), 'export default "ok";\n', 'utf8');
        await writeFile(join(sourcePath, '._happier.exe'), 'appledouble', 'utf8');
        await writeFile(join(sourcePath, 'node_modules', 'example', 'node_modules', '.bin', 'yaml'), 'shim', 'utf8');

        try {
            await replaceRuntimePayloadTree({
                sourcePath,
                destinationPath,
            });

            expect(await readFile(join(destinationPath, 'happier.exe'), 'utf8')).toBe('runtime-binary');
            expect(await readFile(join(destinationPath, 'package-dist', 'index.mjs'), 'utf8')).toContain('ok');
            expect(existsSync(join(destinationPath, '._happier.exe'))).toBe(false);
            expect(existsSync(join(destinationPath, 'node_modules', 'example', 'node_modules', '.bin', 'yaml'))).toBe(false);
        }
        finally {
            await rm(workspace, { recursive: true, force: true });
        }
    });
});
