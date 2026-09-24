import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const powershellInstallerPaths = [
  join(repoRoot, 'scripts', 'release', 'installers', 'install.ps1'),
  join(repoRoot, 'apps', 'website', 'public', 'install.ps1'),
  join(repoRoot, 'apps', 'website', 'public', 'install-preview.ps1'),
  join(repoRoot, 'apps', 'website', 'public', 'install-dev.ps1'),
];

test('PowerShell installers avoid ambiguous variable interpolation before a colon', async () => {
  for (const path of powershellInstallerPaths) {
    const raw = await readFile(path, 'utf8');

    assert.doesNotMatch(
      raw,
      /"\$[A-Za-z_][A-Za-z0-9_]*:"/,
      `expected ${path} to avoid PowerShell variable interpolation like "$Label:"`,
    );
  }
});
