import { describe, expect, it } from 'vitest';

import {
  createGeminiTurnMessageState,
  resolveGeminiTurnCompletionSignal,
  resetGeminiTurnMessageStateForPrompt,
} from './geminiTurnMessageState';

describe('geminiTurnMessageState', () => {
  it('marks thinking and notifies when a prompt turn starts', () => {
    const state = createGeminiTurnMessageState();
    const thinkingSignals: boolean[] = [];

    resetGeminiTurnMessageStateForPrompt(state, 'hello', (thinking) => {
      thinkingSignals.push(thinking);
    });

    expect(state.thinking).toBe(true);
    expect(thinkingSignals).toEqual([true]);
  });

  it('allows task completion only for successful turns with visible turn output', () => {
    expect(resolveGeminiTurnCompletionSignal({
      outcome: { kind: 'completed', stopReason: 'end_turn' },
      hasAssistantOutput: true,
      hadToolCallInTurn: false,
      hadThinkingInTurn: false,
      hadPermissionInTurn: false,
    })).toBe('task_complete');

    expect(resolveGeminiTurnCompletionSignal({
      outcome: { kind: 'completed', stopReason: 'end_turn' },
      hasAssistantOutput: false,
      hadToolCallInTurn: false,
      hadThinkingInTurn: true,
      hadPermissionInTurn: false,
    })).toBe('task_complete');

    expect(resolveGeminiTurnCompletionSignal({
      outcome: { kind: 'completed', stopReason: 'end_turn' },
      hasAssistantOutput: false,
      hadToolCallInTurn: false,
      hadThinkingInTurn: false,
      hadPermissionInTurn: true,
    })).toBe('task_complete');
  });

  it('does not complete failed, aborted, refused, timed-out, or empty turns', () => {
    expect(resolveGeminiTurnCompletionSignal({
      outcome: { kind: 'aborted', stopReason: 'cancelled' },
      hasAssistantOutput: true,
      hadToolCallInTurn: false,
      hadThinkingInTurn: false,
      hadPermissionInTurn: false,
    })).toBe('turn_cancelled');
    expect(resolveGeminiTurnCompletionSignal({
      outcome: { kind: 'refused', stopReason: 'refusal' },
      hasAssistantOutput: true,
      hadToolCallInTurn: false,
      hadThinkingInTurn: false,
      hadPermissionInTurn: false,
    })).toBe('turn_failed');
    expect(resolveGeminiTurnCompletionSignal({
      outcome: { kind: 'timed_out', capMs: 120_000 },
      hasAssistantOutput: true,
      hadToolCallInTurn: false,
      hadThinkingInTurn: false,
      hadPermissionInTurn: false,
    })).toBe('turn_failed');
    expect(resolveGeminiTurnCompletionSignal({
      outcome: { kind: 'failed', error: new Error('provider failed') },
      hasAssistantOutput: true,
      hadToolCallInTurn: false,
      hadThinkingInTurn: false,
      hadPermissionInTurn: false,
    })).toBe('turn_failed');
    expect(resolveGeminiTurnCompletionSignal({
      outcome: { kind: 'completed', stopReason: 'end_turn' },
      hasAssistantOutput: false,
      hadToolCallInTurn: false,
      hadThinkingInTurn: false,
      hadPermissionInTurn: false,
    })).toBe('turn_failed');
    expect(resolveGeminiTurnCompletionSignal({
      outcome: { kind: 'completed', stopReason: 'max_turn_requests' },
      hasAssistantOutput: true,
      hadToolCallInTurn: false,
      hadThinkingInTurn: true,
      hadPermissionInTurn: true,
    })).toBe('turn_failed');
  });
});
