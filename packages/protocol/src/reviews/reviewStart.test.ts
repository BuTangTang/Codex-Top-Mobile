import { describe, expect, it } from 'vitest';

import { ReviewStartInputSchema } from './reviewStart.js';

describe('ReviewStartInputSchema', () => {
  it('defaults review scope to uncommitted changes and does not require explicit coderabbit engine config', () => {
    const parsed = ReviewStartInputSchema.parse({
      engineIds: ['coderabbit'],
      instructions: 'Review.',
      base: { kind: 'none' },
    });

    expect(parsed.changeType).toBe('uncommitted');
    // When coderabbit is selected, surfaces should not need to inject an empty config object.
    expect(parsed.engines?.coderabbit).toEqual({});
  });

  it('defaults missing review instructions to an execution-run review', () => {
    const parsed = ReviewStartInputSchema.parse({
      engineIds: ['codex'],
      base: { kind: 'none' },
    });

    expect(parsed.instructions).toBe('');
    expect(parsed.runLocation).toBe('execution_run');
  });

  it('accepts current-session review location with blank instructions', () => {
    const parsed = ReviewStartInputSchema.parse({
      engineIds: ['codex'],
      instructions: '   ',
      runLocation: 'current_session',
      base: { kind: 'none' },
    });

    expect(parsed.instructions).toBe('');
    expect(parsed.runLocation).toBe('current_session');
  });
});
