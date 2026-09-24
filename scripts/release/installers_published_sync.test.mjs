import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const sourceRoot = join(repoRoot, 'scripts', 'release', 'installers');
const websiteRoot = join(repoRoot, 'apps', 'website', 'public');
const { INSTALLER_PUBLISH_SPECS, applyInstallerPublishTransform } = await import('../pipeline/release/installers/catalog.mjs');

test('published website installers stay in sync with release-owned installer sources', async () => {
  const forbidden = [
    'self-host',
    'self-host.sh',
    'self-host-preview',
    'self-host-preview.sh',
    'self-host-dev',
    'self-host-dev.sh',
    'self-host.ps1',
    'self-host-preview.ps1',
    'self-host-dev.ps1',
  ];

  for (const name of forbidden) {
    await assert.rejects(() => access(join(websiteRoot, name)), /ENOENT/, `expected ${name} to be removed from apps/website/public`);
  }

  for (const spec of INSTALLER_PUBLISH_SPECS) {
    const rawSource = await readFile(join(sourceRoot, spec.source), 'utf8');
    const source = applyInstallerPublishTransform(Buffer.from(rawSource, 'utf8'), spec.transform).toString('utf8');
    for (const target of spec.targets) {
      const published = await readFile(join(websiteRoot, target), 'utf8');
      assert.equal(published, source, `${target} is out of sync with scripts/release/installers/${spec.source}`);
    }
  }
});
