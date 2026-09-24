import type { PrimaryTurnStatusV1 } from '@happier-dev/protocol';

export type LatestTurnStatusSnapshot = PrimaryTurnStatusV1 | null;

export function readLatestTurnStatusSnapshot(value: unknown): LatestTurnStatusSnapshot | undefined {
    if (value === null) return null;
    if (
        value === 'in_progress'
        || value === 'completed'
        || value === 'failed'
        || value === 'cancelled'
    ) {
        return value;
    }
    return undefined;
}

export function isActiveLatestTurnStatus(status: LatestTurnStatusSnapshot | undefined): boolean {
    return status === 'in_progress';
}

export type SessionTurnLifecycleObserverEvent =
    | 'prompt_or_steer'
    | 'task_started'
    | 'assistant_message_end'
    | 'turn_cancelled';

/**
 * Map a canonical session-turn lifecycle event onto the latest-turn-status snapshot.
 * Keeps the locally cached snapshot truthful when turns begin/end through the canonical
 * lifecycle (e.g. Claude unified terminal turns) instead of ACP lifecycle markers, so a
 * stale 'in_progress' snapshot cannot keep blocking pending-queue materialization.
 */
export function latestTurnStatusForTurnLifecycleEvent(
    event: SessionTurnLifecycleObserverEvent,
    terminalStatus?: 'completed' | 'failed',
): PrimaryTurnStatusV1 | undefined {
    if (event === 'prompt_or_steer' || event === 'task_started') return 'in_progress';
    if (event === 'turn_cancelled') return 'cancelled';
    if (event === 'assistant_message_end') return terminalStatus === 'failed' ? 'failed' : 'completed';
    return undefined;
}

export function isTerminalTurnLifecycleEvent(event: SessionTurnLifecycleObserverEvent): boolean {
    return event === 'assistant_message_end' || event === 'turn_cancelled';
}
