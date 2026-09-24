import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEasBuildViewArgs } from './testflight-eas-cli-args.mjs';

test('buildEasBuildViewArgs omits --non-interactive because eas build:view rejects it', () => {
  const args = buildEasBuildViewArgs({ easBuildId: 'build-123' });

  assert.deepEqual(args, ['--yes', 'eas-cli@18.0.1', 'build:view', 'build-123', '--json']);
  assert.equal(args.includes('--non-interactive'), false);
});
