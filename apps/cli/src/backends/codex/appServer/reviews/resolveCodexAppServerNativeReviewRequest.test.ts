import { describe, expect, it } from 'vitest';

import { resolveCodexAppServerNativeReviewRequest } from './resolveCodexAppServerNativeReviewRequest';

describe('resolveCodexAppServerNativeReviewRequest', () => {
  it('preserves multi-line user instructions by using a custom target', () => {
    const resolved = resolveCodexAppServerNativeReviewRequest({
      start: {
        intent: 'review',
        intentInput: {
          engineIds: ['codex'],
          instructions: 'Check correctness.\n\nAlso inspect tests.',
          changeType: 'uncommitted',
          base: { kind: 'none' },
        },
      },
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.request.delivery).toBe('inline');
    expect(resolved.request.target).toMatchObject({
      type: 'custom',
      instructions: expect.stringContaining('Check correctness.\n\nAlso inspect tests.'),
    });
    expect(resolved.request.target).toMatchObject({
      instructions: expect.stringContaining('Review scope:'),
    });
    expect(resolved.request.target).toMatchObject({
      instructions: expect.not.stringContaining('output ONE final JSON object'),
    });
  });

  it('uses uncommittedChanges for exact instruction-less uncommitted scope', () => {
    const resolved = resolveCodexAppServerNativeReviewRequest({
      start: {
        intent: 'review',
        intentInput: {
          engineIds: ['codex'],
          changeType: 'uncommitted',
          base: { kind: 'none' },
        },
      },
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.request.target).toEqual({ type: 'uncommittedChanges' });
  });

  it('uses baseBranch for exact instruction-less branch committed scope', () => {
    const resolved = resolveCodexAppServerNativeReviewRequest({
      start: {
        intent: 'review',
        intentInput: {
          engineIds: ['codex'],
          changeType: 'committed',
          base: { kind: 'branch', baseBranch: 'main' },
        },
      },
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.request.target).toEqual({ type: 'baseBranch', branch: 'main' });
  });

  it('falls back to custom scope-only instructions for all changes', () => {
    const resolved = resolveCodexAppServerNativeReviewRequest({
      start: {
        intent: 'review',
        intentInput: {
          engineIds: ['codex'],
          changeType: 'all',
          base: { kind: 'branch', baseBranch: 'main' },
        },
      },
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.request.target).toMatchObject({
      type: 'custom',
      instructions: expect.stringContaining('Change type: all'),
    });
  });

  it('does not map Happier base commits to Codex commit targets', () => {
    const resolved = resolveCodexAppServerNativeReviewRequest({
      start: {
        intent: 'review',
        intentInput: {
          engineIds: ['codex'],
          changeType: 'committed',
          base: { kind: 'commit', baseCommit: 'abc123' },
        },
      },
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.request.target).toMatchObject({
      type: 'custom',
      instructions: expect.stringContaining('Base commit: abc123'),
    });
  });

  it('rejects review follow-up input so follow-ups stay prompt-based', () => {
    const resolved = resolveCodexAppServerNativeReviewRequest({
      start: {
        intent: 'review',
        intentInput: {
          kind: 'review_follow_up.v1',
          parentRunRef: { runId: 'run_1', callId: 'call_1', backendId: 'codex' },
          threadId: 'thread_1',
          messageMarkdown: 'Can you expand?',
          summary: 'Summary',
          overviewMarkdown: 'Overview',
        },
      },
    });

    expect(resolved).toMatchObject({ ok: false, reason: 'unsupported_follow_up' });
  });
});
