import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function readEasJson() {
  const easPath = path.resolve(repoRoot, 'apps', 'ui', 'eas.json');
  return JSON.parse(fs.readFileSync(easPath, 'utf8'));
}

test('EAS apk build profiles use assembleRelease (no interactive prompt in non-interactive builds)', async () => {
  const eas = readEasJson();
  const build = eas?.build ?? {};

  for (const profileName of ['internalpreview-apk', 'publicdev-apk', 'preview-apk', 'production-apk']) {
    const profile = build?.[profileName] ?? {};
    const android = profile?.android ?? {};
    assert.equal(android.buildType, 'apk', `${profileName} should set android.buildType=apk`);

    const gradleCommand = String(android.gradleCommand ?? '');
    assert.ok(gradleCommand, `${profileName} should override android.gradleCommand for apk builds`);
    assert.match(gradleCommand, /assembleRelease/i, `${profileName} gradleCommand should run assembleRelease`);
    assert.doesNotMatch(gradleCommand, /bundle/i, `${profileName} gradleCommand must not include bundleRelease`);
  }
});

test('EAS production APK build enables size reduction (minify, shrink resources, single arch)', async () => {
  const eas = readEasJson();
  const profile = eas?.build?.['production-apk'] ?? {};
  const env = profile?.env ?? {};

  assert.equal(env.HAPPIER_ANDROID_BUILD_ARCHS, 'arm64-v8a', 'production-apk should build a single ABI to keep the APK small');
  assert.equal(env.HAPPIER_ANDROID_ENABLE_MINIFY, '1', 'production-apk should enable R8 minification');
  assert.equal(env.HAPPIER_ANDROID_ENABLE_SHRINK_RESOURCES, '1', 'production-apk should enable resource shrinking');
});
