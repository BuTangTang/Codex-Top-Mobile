import { describe, expect, it } from 'vitest';

import { verifyResumeReachableOpenCode } from './verifyResumeReachableOpenCode';

describe('verifyResumeReachableOpenCode', () => {
  it('fails closed because OpenCode shared-state resume reachability is unsupported', async () => {
    await expect(verifyResumeReachableOpenCode({
      targetMaterializedRoot: '/tmp/fake',
      targetMaterializedEnv: {},
      vendorResumeId: 'vendor-session-1',
      cwd: '/tmp/fake',
    })).resolves.toEqual({
      ok: false,
      reason: 'opencode_state_not_shared',
    });
  });
});
