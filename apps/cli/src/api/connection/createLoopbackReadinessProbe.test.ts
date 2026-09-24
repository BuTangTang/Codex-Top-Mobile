import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGet = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: { get: axiosGet },
}));

import { createLoopbackReadinessProbe } from './createLoopbackReadinessProbe';

describe('createLoopbackReadinessProbe', () => {
  beforeEach(() => {
    axiosGet.mockReset();
    vi.unstubAllGlobals();
  });

  it('uses the canonical feature observation after the loopback health check', async () => {
    axiosGet.mockResolvedValueOnce({ status: 200 });
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createLoopbackReadinessProbe({
      serverUrl: 'http://127.0.0.1:48123',
      token: 'account-token',
    })()).resolves.toMatchObject({ status: 'auth_failed', statusCode: 401 });

    expect(axiosGet).toHaveBeenCalledOnce();
    expect(axiosGet).toHaveBeenCalledWith(
      'http://127.0.0.1:48123/health',
      expect.objectContaining({ validateStatus: expect.any(Function) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:48123/v1/features',
      expect.objectContaining({
        headers: { Authorization: 'Bearer account-token' },
        redirect: 'manual',
      }),
    );
  });
});
