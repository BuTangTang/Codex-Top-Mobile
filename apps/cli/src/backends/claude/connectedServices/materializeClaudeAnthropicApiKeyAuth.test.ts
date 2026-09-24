import { describe, expect, it } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { materializeClaudeAnthropicApiKeyAuth } from './materializeClaudeAnthropicApiKeyAuth';

describe('materializeClaudeAnthropicApiKeyAuth', () => {
  it('maps token credentials to ANTHROPIC_API_KEY', () => {
    const now = Date.now();
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'anthropic',
      profileId: 'default',
      kind: 'token',
      token: { token: 'sk-ant-test', providerAccountId: null, providerEmail: null },
    });

    const res = materializeClaudeAnthropicApiKeyAuth({ record });
    expect(res.env).toMatchObject({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(res.env).not.toHaveProperty('CLAUDE_CODE_SETUP_TOKEN');
    expect(res.env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('rejects oauth credentials', () => {
    const now = Date.now();
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'anthropic',
      profileId: 'default',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: null,
        providerEmail: null,
      },
    });

    expect(() => materializeClaudeAnthropicApiKeyAuth({ record })).toThrow(/oauth/i);
  });
});
