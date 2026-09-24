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

function extractBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing block start ${startNeedle}`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing block end ${endNeedle}`);
  return src.slice(start, end);
}

test('expo submit supports disabling wait (so native_submit does not block on long EAS queues)', () => {
  const src = readRepoFile('scripts/pipeline/expo/submit.mjs');
  assert.match(src, /\bwait:\s*\{\s*type:\s*'string'/, 'expected submit.mjs to accept a wait flag');
  assert.match(src, /function\s+parseBool\s*\(/, 'expected submit.mjs to define parseBool helper');
  assert.match(src, /--no-wait/, "expected submit.mjs to pass '--no-wait' when wait is disabled");
});

test('expo submit can force Android submissions to draft release status by default', () => {
  const src = readRepoFile('scripts/pipeline/expo/submit.mjs');

  assert.match(
    src,
    /'android-release-status':\s*\{\s*type:\s*'string',\s*default:\s*'draft'/,
    'expected submit.mjs to default Android release status to draft',
  );
  assert.match(
    src,
    /releaseStatus\s*=\s*androidReleaseStatus/,
    'expected submit.mjs to write android.releaseStatus for the selected submit profile',
  );
});

test('expo submit writes temporary eas.json overrides atomically', () => {
  const src = readRepoFile('scripts/pipeline/expo/submit.mjs');
  assert.match(src, /function\s+writeTextFileAtomic\s*\(/, 'expected an atomic file write helper');
  assert.match(src, /writeTextFileAtomic\(easPath,\s*next\)/, 'expected override writes to be atomic');
  assert.match(src, /writeTextFileAtomic\(easPath,\s*original\)/, 'expected restore writes to be atomic');
  assert.doesNotMatch(src, /fs\.writeFileSync\(easPath,/, 'eas.json must not be truncated in-place during submit tests');
});

test('run.mjs expo-submit passes the Android release status through to submit.mjs', () => {
  const src = readRepoFile('scripts/pipeline/run.mjs');
  const block = extractBetween(src, "subcommand === 'expo-submit'", "subcommand === 'expo-download-apk'");

  assert.match(
    block,
    /'android-release-status':\s*\{\s*type:\s*'string',\s*default:\s*'draft'/,
    'expected run.mjs expo-submit to accept an Android release status flag',
  );
  assert.match(
    block,
    /'--android-release-status'[^]*androidReleaseStatus/,
    'expected run.mjs expo-submit to pass the Android release status to submit.mjs',
  );
});
