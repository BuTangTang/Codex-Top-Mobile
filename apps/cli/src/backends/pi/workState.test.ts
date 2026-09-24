import { describe, expect, it } from 'vitest';

describe('Pi work state fallback', () => {
  it('does not fabricate work state without a native task source', async () => {
    const mod = await import('./workState').catch(() => null);
    expect(mod?.buildPiWorkStateFallback).toEqual(expect.any(Function));
    expect(mod!.buildPiWorkStateFallback()).toBeNull();
  });
});
