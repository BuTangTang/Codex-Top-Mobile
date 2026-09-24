import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

function readRepoFile(relPath) {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..', '..');
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

test('ui-mobile OTA forwards platform and splits all-platform fingerprint runtimes', () => {
  const src = readRepoFile('scripts/pipeline/run.mjs');

  assert.match(src, /subcommand === 'expo-ota'[\s\S]+platform:\s*\{\s*type:\s*'string'/);
  assert.match(src, /subcommand === 'expo-ota'[\s\S]+['"]--platform['"]/);
  assert.match(src, /const otaPlatforms = platform === 'all' \? \['android', 'ios'\] : \[platform\]/);
  assert.match(src, /runExpoOtaUpdate[\s\S]+['"]--platform['"][\s\S]+otaPlatform/);
});
