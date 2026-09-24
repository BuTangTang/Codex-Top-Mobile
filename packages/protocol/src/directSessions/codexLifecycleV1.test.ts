import { describe, expect, it } from 'vitest';
import { CodexLifecycleV1Schema, unknownCodexLifecycleV1 } from './codexLifecycleV1';

describe('CodexLifecycleV1Schema', () => {
  it('accepts explicit display facts and rejects control data or invented event timestamps', () => {
    expect(CodexLifecycleV1Schema.parse(unknownCodexLifecycleV1(2000))).toEqual({ v: 1, state: 'unknown', eventAtMs: null, checkedAtMs: 2000 });
    const known = { v: 1, state: 'needs_input', eventAtMs: 1000, checkedAtMs: 2000 };
    expect(CodexLifecycleV1Schema.parse(known)).toEqual(known);
    for (const invalid of [
      { ...known, requests: [{ requestId: 'control' }] },
      { ...known, state: 'unknown' },
      { ...known, eventAtMs: null },
      { ...known, eventAtMs: 3000 },
      { ...known, v: 2 },
      { ...known, checkedAtMs: NaN },
    ]) expect(CodexLifecycleV1Schema.safeParse(invalid).success).toBe(false);
  });
});
