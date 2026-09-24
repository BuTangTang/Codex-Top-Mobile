import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeOpenAiCodexOauthRefreshToken } from './openCodeAuthState';

describe('probeOpenAiCodexOauthRefreshToken', () => {
  const previousTimeout = process.env.HAPPIER_OPENCODE_OAUTH_REFRESH_TOKEN_PROBE_TIMEOUT_MS;

  afterEach(() => {
    if (typeof previousTimeout === 'string') {
      process.env.HAPPIER_OPENCODE_OAUTH_REFRESH_TOKEN_PROBE_TIMEOUT_MS = previousTimeout;
    } else {
      delete process.env.HAPPIER_OPENCODE_OAUTH_REFRESH_TOKEN_PROBE_TIMEOUT_MS;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns unknown when the token probe times out', async () => {
    process.env.HAPPIER_OPENCODE_OAUTH_REFRESH_TOKEN_PROBE_TIMEOUT_MS = '25';
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(probeOpenAiCodexOauthRefreshToken('refresh-token')).resolves.toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears pending timeout handles after a successful probe', async () => {
    vi.useFakeTimers();
    process.env.HAPPIER_OPENCODE_OAUTH_REFRESH_TOKEN_PROBE_TIMEOUT_MS = '25';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(probeOpenAiCodexOauthRefreshToken('refresh-token')).resolves.toBe('valid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
