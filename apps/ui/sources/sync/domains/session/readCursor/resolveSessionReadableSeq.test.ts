import { describe, expect, it } from 'vitest';

import { resolveSessionReadableSeq } from './resolveSessionReadableSeq';
import type { Message } from '@/sync/domains/messages/messageTypes';

const visibleAgentMessage = {
    id: 'm-visible',
    seq: 10,
    localId: null,
    kind: 'agent-text',
    text: 'done',
    createdAt: 100,
} satisfies Message;

const authSwitchMaintenanceEvent = {
    id: 'm-auth-switch',
    seq: 11,
    kind: 'agent-event',
    createdAt: 101,
    event: {
        type: 'connected-service-account-switch',
        serviceId: 'openai-codex',
        groupId: 'happier',
        fromProfileId: 'profile-a',
        toProfileId: 'profile-b',
        reason: 'usage_limit',
        mode: 'hot_apply',
    },
} satisfies Message;

describe('resolveSessionReadableSeq', () => {
    it('does not let trailing auth maintenance events become unread through raw message seq fallback', () => {
        expect(resolveSessionReadableSeq({
            messages: [visibleAgentMessage, authSwitchMaintenanceEvent],
            latestMessageSeq: authSwitchMaintenanceEvent.seq,
            sessionSeq: authSwitchMaintenanceEvent.seq,
            latestTurnStatus: 'in_progress',
            includeTerminalSessionSeq: true,
        })).toBe(visibleAgentMessage.seq);
    });

    it('does not let trailing auth maintenance events become unread through terminal session seq fallback', () => {
        expect(resolveSessionReadableSeq({
            messages: [visibleAgentMessage, authSwitchMaintenanceEvent],
            sessionSeq: authSwitchMaintenanceEvent.seq,
            latestTurnStatus: 'completed',
            includeTerminalSessionSeq: true,
        })).toBe(visibleAgentMessage.seq);
    });
});
