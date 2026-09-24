import { describe, expect, it } from 'vitest';

import { resolvePiCompactionTurnOutcome } from './resolvePiCompactionTurnOutcome';

describe('resolvePiCompactionTurnOutcome', () => {
  it('treats a completed final answer with a failed post-final compaction as completed (no escalation)', () => {
    // The exact live failure: final answer committed (stopReason 'stop'), then a maintenance
    // compaction fails with an auth-classifiable error. Completed-final must win over terminal.
    const outcome = resolvePiCompactionTurnOutcome({
      lastAssistantStopReason: 'stop',
      lastCompactionEnd: {
        willRetry: false,
        errorMessage: 'Codex usage_limit_reached during overflow summarization.',
      },
    });

    expect(outcome).toEqual({ kind: 'completed_post_final' });
  });

  it('treats a completed final answer with a clean post-final compaction as completed', () => {
    const outcome = resolvePiCompactionTurnOutcome({
      lastAssistantStopReason: 'stop',
      lastCompactionEnd: { willRetry: false, errorMessage: null },
    });

    expect(outcome).toEqual({ kind: 'completed_post_final' });
  });

  it('fails-closed on a terminal compaction failure for genuinely unfinished work', () => {
    const outcome = resolvePiCompactionTurnOutcome({
      lastAssistantStopReason: null,
      lastCompactionEnd: {
        willRetry: false,
        errorMessage: 'Context compaction dependency failed.',
      },
    });

    expect(outcome).toEqual({
      kind: 'terminal_failure',
      detail: 'Context compaction dependency failed.',
    });
  });

  it('fails-closed when the last assistant turn errored rather than completing', () => {
    // A non-'stop' stop reason is not a completed final answer, so a terminal compaction failure
    // still escalates.
    const outcome = resolvePiCompactionTurnOutcome({
      lastAssistantStopReason: 'error',
      lastCompactionEnd: {
        willRetry: false,
        errorMessage: 'Context compaction dependency failed.',
      },
    });

    expect(outcome).toEqual({
      kind: 'terminal_failure',
      detail: 'Context compaction dependency failed.',
    });
  });

  it('returns a plain pause for a threshold/manual compaction with no terminal error', () => {
    const outcome = resolvePiCompactionTurnOutcome({
      lastAssistantStopReason: null,
      lastCompactionEnd: { willRetry: false, errorMessage: null },
    });

    expect(outcome).toEqual({ kind: 'pause' });
  });

  it('returns a plain pause when no compaction end has been observed', () => {
    const outcome = resolvePiCompactionTurnOutcome({
      lastAssistantStopReason: null,
      lastCompactionEnd: null,
    });

    expect(outcome).toEqual({ kind: 'pause' });
  });
});
