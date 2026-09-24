import type { SessionEventMessage } from '@/api/session/sessionMessageTypes';

export type ClaudeTerminalComposerDraftBlockedReason = 'idle_draft_guard' | 'in_flight_steer';

const IN_FLIGHT_STEER_DRAFT_BLOCKED_MESSAGE =
  'Your queued message can\'t steer the running turn: the terminal composer holds an unsent draft. Clear the draft in the terminal (or interrupt the turn) to deliver it.';

const IDLE_DRAFT_GUARD_BLOCKED_MESSAGE =
  'Your queued message is waiting: the terminal composer holds an unsent draft. Clear the draft in the terminal to deliver it.';

export function createTerminalComposerDraftBlockedEvent(
  reason: ClaudeTerminalComposerDraftBlockedReason,
  nowMs: () => number = Date.now,
): Extract<SessionEventMessage, { type: 'terminal-composer-draft-blocked' }> {
  return {
    type: 'terminal-composer-draft-blocked',
    reason,
    stateAtMs: nowMs(),
    message: reason === 'in_flight_steer'
      ? IN_FLIGHT_STEER_DRAFT_BLOCKED_MESSAGE
      : IDLE_DRAFT_GUARD_BLOCKED_MESSAGE,
  };
}
