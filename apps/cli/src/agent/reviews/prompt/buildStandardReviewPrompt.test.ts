import { describe, expect, it } from 'vitest';

import { buildReviewScopeGuidanceBlock } from './buildReviewScopeGuidanceBlock';
import { buildStandardReviewPrompt } from './buildStandardReviewPrompt';

describe('buildStandardReviewPrompt', () => {
  it('requires initial reviews to inspect accessible workspace context before finalizing', () => {
    const prompt = buildStandardReviewPrompt({
      instructions: 'Review the current workspace thoroughly.',
    });

    expect(prompt).toContain('Inspect the accessible workspace');
    expect(prompt).toContain('Do not stop at a plan');
    expect(prompt).toContain('add a question instead of guessing');
  });

  it('includes explicit review scope guidance for normal review launches', () => {
    const prompt = buildStandardReviewPrompt({
      instructions: 'Review the current session changes.',
      intentInput: {
        engineIds: ['claude'],
        instructions: 'Review the current session changes.',
        changeType: 'committed',
        base: { kind: 'none' },
      },
    });

    expect(prompt).toContain('Review scope:');
    expect(prompt).toContain('Change type: committed');
    expect(prompt).toContain('Base: infer the repository');
    expect(prompt).toContain('Do not broaden the review to unrelated repository areas');
  });

  it('builds prompt-based review instructions when the user leaves instructions blank', () => {
    const prompt = buildStandardReviewPrompt({
      instructions: '',
      intentInput: {
        engineIds: ['codex'],
        changeType: 'uncommitted',
        base: { kind: 'none' },
      },
    });

    expect(prompt).toContain('Review the scoped changes');
    expect(prompt).toContain('Review scope:');
    expect(prompt).toContain('output ONE final JSON object');
  });

  it('exposes reusable review scope guidance for native review mappers', () => {
    const scope = buildReviewScopeGuidanceBlock({
      engineIds: ['codex'],
      changeType: 'all',
      base: { kind: 'commit', baseCommit: 'abc123' },
    });

    expect(scope).toContain('Review scope:');
    expect(scope).toContain('Change type: all');
    expect(scope).toContain('Base commit: abc123');
  });
});
