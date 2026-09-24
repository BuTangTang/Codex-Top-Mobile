import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCanonicalFingerprintFromExpoFingerprint,
  shouldExcludeCanonicalFingerprintSource,
} from './canonical-fingerprint.mjs';

test('canonical Expo fingerprint excludes generated native artifacts but keeps package source entries', () => {
  assert.equal(
    shouldExcludeCanonicalFingerprintSource({ type: 'dir', filePath: 'ios', reasons: ['bareNativeDir'] }),
    true,
  );
  assert.equal(
    shouldExcludeCanonicalFingerprintSource({ type: 'dir', filePath: 'android', reasons: ['bareNativeDir'] }),
    true,
  );
  assert.equal(
    shouldExcludeCanonicalFingerprintSource({
      type: 'dir',
      filePath: 'node_modules/react-native-enriched-markdown/ios/generated',
      reasons: ['rncoreAutolinkingIos'],
    }),
    true,
  );
  assert.equal(
    shouldExcludeCanonicalFingerprintSource({
      type: 'dir',
      filePath: 'node_modules/react-native-unistyles/nitrogen/generated',
      reasons: ['rncoreAutolinkingIos'],
    }),
    true,
  );
  assert.equal(
    shouldExcludeCanonicalFingerprintSource({
      type: 'dir',
      filePath: 'node_modules/react-native-unistyles/ios',
      reasons: ['rncoreAutolinkingIos'],
      hash: 'stable-native-source',
    }),
    false,
  );
});

test('canonical Expo fingerprint recomputes the hash after filtering volatile sources', () => {
  const input = {
    hash: 'raw',
    sources: [
      { type: 'file', filePath: 'eas.json', reasons: ['easBuild'], hash: 'a' },
      { type: 'dir', filePath: 'ios', reasons: ['bareNativeDir'], hash: 'b' },
      {
        type: 'dir',
        filePath: 'node_modules/react-native-unistyles/nitrogen/generated',
        reasons: ['rncoreAutolinkingIos'],
        hash: 'c',
      },
      { type: 'contents', id: 'expoConfig', reasons: ['expoConfig'], hash: 'd' },
    ],
  };

  const canonical = createCanonicalFingerprintFromExpoFingerprint(input);

  assert.notEqual(canonical.hash, input.hash);
  assert.deepEqual(
    canonical.sources.map((source) => source.filePath ?? source.id),
    ['eas.json', 'expoConfig'],
  );
});
