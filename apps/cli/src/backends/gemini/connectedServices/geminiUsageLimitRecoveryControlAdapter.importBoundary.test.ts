import { describe, expect, it, vi } from 'vitest';

describe('geminiUsageLimitRecoveryControlAdapter import boundary', () => {
  it('loads without importing the full ApiClient module', async () => {
    vi.resetModules();
    vi.doMock('@/api/api', () => {
      throw new Error('gemini usage-limit recovery must not statically import the full ApiClient');
    });

    const mod = await import('./geminiUsageLimitRecoveryControlAdapter');

    expect(mod.createGeminiUsageLimitRecoveryControlAdapter).toBeTypeOf('function');
  });
});
