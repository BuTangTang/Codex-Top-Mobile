import { hasChangeTitleInstruction } from '../utils/promptUtils';
import type { AcpTurnOutcome } from '@/agent/acp/backend/turn/_types';

export type GeminiTurnMessageState = {
  thinking: boolean;
  accumulatedResponse: string;
  isResponseInProgress: boolean;
  hadToolCallInTurn: boolean;
  hadThinkingInTurn: boolean;
  hadPermissionInTurn: boolean;
  pendingChangeTitle: boolean;
  changeTitleCompleted: boolean;
  taskStartedSent: boolean;
};

export type GeminiTurnCompletionSignal = 'task_complete' | 'turn_failed' | 'turn_cancelled';

export function createGeminiTurnMessageState(): GeminiTurnMessageState {
  return {
    thinking: false,
    accumulatedResponse: '',
    isResponseInProgress: false,
    hadToolCallInTurn: false,
    hadThinkingInTurn: false,
    hadPermissionInTurn: false,
    pendingChangeTitle: false,
    changeTitleCompleted: false,
    taskStartedSent: false,
  };
}

export function resetGeminiTurnMessageStateForPrompt(
  state: GeminiTurnMessageState,
  prompt: string,
  onThinkingChange?: (thinking: boolean) => void,
): void {
  state.accumulatedResponse = '';
  state.isResponseInProgress = false;
  state.hadToolCallInTurn = false;
  state.hadThinkingInTurn = false;
  state.hadPermissionInTurn = false;
  state.taskStartedSent = false;
  state.pendingChangeTitle = hasChangeTitleInstruction(prompt);
  state.changeTitleCompleted = false;
  state.thinking = true;
  onThinkingChange?.(true);
}

export function resetGeminiTurnMessageStateAfterTurn(
  state: GeminiTurnMessageState,
): void {
  state.hadToolCallInTurn = false;
  state.hadThinkingInTurn = false;
  state.hadPermissionInTurn = false;
  state.pendingChangeTitle = false;
  state.changeTitleCompleted = false;
  state.taskStartedSent = false;
  state.thinking = false;
}

export function resolveGeminiTurnCompletionSignal(params: Readonly<{
  outcome: AcpTurnOutcome | null | undefined | void;
  hasAssistantOutput: boolean;
  hadToolCallInTurn: boolean;
  hadThinkingInTurn: boolean;
  hadPermissionInTurn: boolean;
}>): GeminiTurnCompletionSignal {
  const hasTurnActivity =
    params.hasAssistantOutput ||
    params.hadToolCallInTurn ||
    params.hadThinkingInTurn ||
    params.hadPermissionInTurn;
  const outcome = params.outcome ?? null;

  if (outcome?.kind === 'aborted') return 'turn_cancelled';
  if (
    outcome?.kind === 'failed' ||
    outcome?.kind === 'refused' ||
    outcome?.kind === 'timed_out'
  ) {
    return 'turn_failed';
  }
  if (outcome?.kind === 'completed' && outcome.stopReason === 'max_turn_requests') {
    return 'turn_failed';
  }
  return hasTurnActivity ? 'task_complete' : 'turn_failed';
}
