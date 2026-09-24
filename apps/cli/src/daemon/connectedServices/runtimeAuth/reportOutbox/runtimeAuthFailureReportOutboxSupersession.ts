export type RuntimeAuthFailureReportOutboxSupersessionEvent =
  | Readonly<{
    kind: 'turn_lifecycle';
    event: 'prompt_or_steer' | 'task_started' | 'assistant_message_end' | 'turn_cancelled';
    // REV-1: how the turn terminated (only meaningful for `assistant_message_end`,
    // which failTurn/turn_failed markers emit too). Absent on legacy producers.
    terminalStatus?: 'completed' | 'failed';
  }>
  | Readonly<{
    kind: 'manual_session_supersession';
    reason: 'stop' | 'switch' | 'restart' | 'newer_input';
  }>;

export function shouldClearRuntimeAuthFailureReportOutboxForSupersession(
  event: RuntimeAuthFailureReportOutboxSupersessionEvent,
): boolean {
  if (event.kind === 'manual_session_supersession') return true;
  return event.event === 'turn_cancelled' || event.event === 'prompt_or_steer';
}

export async function clearRuntimeAuthFailureReportOutboxForSupersession(input: Readonly<{
  sessionId: string;
  event: RuntimeAuthFailureReportOutboxSupersessionEvent;
  removeForSession: (sessionId: string) => Promise<void> | void;
}>): Promise<void> {
  if (!shouldClearRuntimeAuthFailureReportOutboxForSupersession(input.event)) return;
  await input.removeForSession(input.sessionId);
}
