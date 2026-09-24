import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('pipeline npm publish uses the dev dist-tag for the public dev lane', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'happier-npm-publish-dev-'));
    const tarball = resolve(dir, 'artifact.tgz');
    writeFileSync(tarball, 'stub', 'utf8');

    const out = execFileSync(
        process.execPath,
        [
            resolve(repoRoot, 'scripts', 'pipeline', 'npm', 'publish-tarball.mjs'),
            '--channel',
            'dev',
            '--tarball',
            tarball,
            '--dry-run',
        ],
        {
            cwd: repoRoot,
            env: { ...process.env },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 30_000,
        },
    );

    assert.match(out, /\s--tag dev\b/);
});
