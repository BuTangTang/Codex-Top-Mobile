import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/api', () => {
  throw new Error('routed resume prompt tier sources must not statically import the full ApiClient');
});

describe('buildRoutedResumePromptTierSources import boundary', () => {
  it('loads without importing the full ApiClient module', async () => {
    const mod = await import('./buildRoutedResumePromptTierSources');

    expect(mod.buildRoutedResumePromptTierSources).toBeTypeOf('function');
  });
});
