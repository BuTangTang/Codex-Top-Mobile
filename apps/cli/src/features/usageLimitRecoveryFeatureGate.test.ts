import { describe, expect, it } from 'vitest';

import { SessionUsageLimitRecoveryOperationResultV1Schema } from '@happier-dev/protocol';

import { usageLimitRecoveryFeatureDisabledResult } from './usageLimitRecoveryFeatureGate';

describe('usageLimitRecoveryFeatureDisabledResult', () => {
  it('returns a schema-valid usage-limit operation result', () => {
    expect(SessionUsageLimitRecoveryOperationResultV1Schema.parse(
      usageLimitRecoveryFeatureDisabledResult({ sessionId: 'sess_1' }),
    )).toEqual({
      ok: false,
      status: 'unsupported',
      sessionId: 'sess_1',
      errorCode: 'feature_disabled',
    });
  });
});
