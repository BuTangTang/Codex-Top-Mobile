import type { AgentEvent } from '@/sync/typesRaw';

const LEGACY_TERMINAL_COMPOSER_DRAFT_MESSAGES = new Set([
    'Your queued message can\'t steer the running turn: the terminal composer holds an unsent draft. Clear the draft in the terminal (or interrupt the turn) to deliver it.',
    'Your queued message is waiting: the terminal composer holds an unsent draft. Clear the draft in the terminal to deliver it.',
]);

export function isTerminalComposerDraftBlockedEvent(event: AgentEvent): boolean {
    if (event.type === 'terminal-composer-draft-blocked') {
        return true;
    }
    return event.type === 'message' && LEGACY_TERMINAL_COMPOSER_DRAFT_MESSAGES.has(event.message);
}

export function readTerminalComposerDraftBlockedStateAtMs(event: AgentEvent): number | null {
    if (event.type !== 'terminal-composer-draft-blocked') return null;
    return typeof event.stateAtMs === 'number' && Number.isFinite(event.stateAtMs)
        ? Math.trunc(event.stateAtMs)
        : null;
}
