import { describe, expect, it } from 'vitest';

import { resolveUnsupportedSwitchContinuityErrorCode } from './resolveUnsupportedSwitchContinuityErrorCode';

describe('resolveUnsupportedSwitchContinuityErrorCode', () => {
  it('keeps unsupported_service only for true unsupported backend or service reasons', () => {
    expect(resolveUnsupportedSwitchContinuityErrorCode('unsupported_service')).toBe('unsupported_service');
  });

  it('preserves provider session state failures as resume continuity diagnostics', () => {
    expect(resolveUnsupportedSwitchContinuityErrorCode('provider_session_state_unavailable_for_resume'))
      .toBe('provider_session_state_unavailable_for_resume');
  });

  it('does not collapse provider-specific continuity refusals into unsupported_service', () => {
    expect(resolveUnsupportedSwitchContinuityErrorCode('codex_api_key_switch_continuity_unsupported'))
      .toBe('continuity_unsupported');
  });
});
