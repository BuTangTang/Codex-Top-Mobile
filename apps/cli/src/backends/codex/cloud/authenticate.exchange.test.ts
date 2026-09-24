import { describe, expect, it, vi } from 'vitest';

import { exchangeCodexAuthorizationCodeForTokens } from './authenticate';

describe('exchangeCodexAuthorizationCodeForTokens', () => {
  it('returns expiresAt when expires_in is present', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id_token: 'hdr.eyJjaGF0Z3B0X2FjY291bnRfaWQiOiJhY2N0XzEifQ.sig',
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 60,
      }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const now = 1700000000000;
    const tokens = await exchangeCodexAuthorizationCodeForTokens({
      code: 'code',
      verifier: 'verifier',
      redirectUri: 'http://localhost:1455/auth/callback',
      now,
    });

    expect(tokens.expiresAt).toBe(now + 60_000);
  });

  it('redacts token exchange failure response bodies', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({}),
      text: async () => JSON.stringify({
        error: 'invalid_grant',
        error_description: 'refresh token codex-secret-refresh was rejected',
        access_token: 'codex-secret-access',
        refresh_token: 'codex-secret-refresh',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    let caught: unknown = null;
    try {
      await exchangeCodexAuthorizationCodeForTokens({
        code: 'code',
        verifier: 'verifier',
        redirectUri: 'http://localhost:1455/auth/callback',
        now: 1700000000000,
      });
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toMatch(/Token exchange failed \(400\): invalid_grant/);
    expect(String(caught)).not.toMatch(/codex-secret-refresh|codex-secret-access|error_description/);
  });
});
