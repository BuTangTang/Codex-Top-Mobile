import { describe, expect, it, vi } from 'vitest';

import { readCodexRateLimitsSnapshot } from './readCodexRateLimitsSnapshot';

describe('readCodexRateLimitsSnapshot', () => {
  it('uses null params first for account/rateLimits/read', async () => {
    const request = vi.fn(async () => ({ rateLimits: { planType: 'pro' } }));

    await expect(readCodexRateLimitsSnapshot({ request })).resolves.toEqual({
      rateLimits: { planType: 'pro' },
    });
    expect(request).toHaveBeenCalledWith('account/rateLimits/read', null);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries with empty-object params when null params are rejected', async () => {
    const request = vi.fn(async (_method, params) => {
      if (params === null) throw new Error('invalid params');
      return { rateLimits: { planType: 'plus' } };
    });

    await expect(readCodexRateLimitsSnapshot({ request })).resolves.toEqual({
      rateLimits: { planType: 'plus' },
    });
    expect(request.mock.calls).toEqual([
      ['account/rateLimits/read', null],
      ['account/rateLimits/read', {}],
    ]);
  });

  it('preserves the first provider error when both params shapes fail', async () => {
    const firstError = new Error('null params rejected');
    const request = vi.fn(async (_method, params) => {
      if (params === null) throw firstError;
      throw new Error('empty object rejected');
    });

    await expect(readCodexRateLimitsSnapshot({ request })).rejects.toBe(firstError);
  });
});
