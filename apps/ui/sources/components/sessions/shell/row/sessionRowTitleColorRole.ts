import type { SessionRowAttentionState, SessionRowTitleTone } from './resolveSessionRowPresentation';

export type SessionListActiveColorModeV1 =
    | 'activityAndAttention'
    | 'attentionOnly'
    | 'allActive';

export type SessionRowTitleColorRole = 'primary' | 'secondary';

export function normalizeSessionListActiveColorMode(value: unknown): SessionListActiveColorModeV1 {
    return value === 'attentionOnly' || value === 'allActive'
        ? value
        : 'activityAndAttention';
}

export function resolveSessionRowTitleColorRole(input: Readonly<{
    mode: SessionListActiveColorModeV1;
    selected: boolean;
    isConnected: boolean;
    isSessionActive: boolean;
    attentionState: SessionRowAttentionState;
    titleTone: SessionRowTitleTone;
}>): SessionRowTitleColorRole {
    if (input.selected) return 'primary';
    if (!input.isConnected) return 'secondary';

    if (input.mode === 'allActive') {
        return input.isSessionActive || input.titleTone !== 'quiet' ? 'primary' : 'secondary';
    }

    if (input.mode === 'attentionOnly') {
        return isUserAttentionState(input.attentionState) ? 'primary' : 'secondary';
    }

    return input.titleTone === 'quiet' ? 'secondary' : 'primary';
}

function isUserAttentionState(attentionState: SessionRowAttentionState): boolean {
    return attentionState === 'unread'
        || attentionState === 'pending'
        || attentionState === 'ready'
        || attentionState === 'failed'
        || attentionState === 'permission_required'
        || attentionState === 'action_required';
}
