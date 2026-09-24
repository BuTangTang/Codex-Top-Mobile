import { describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from './sessionListRenderable';
import { readSessionListUpdatedOrderingKey, SESSION_LIST_UPDATED_ORDERING_BUCKET_MS } from './sessionListOrderingRules';

function makeRow(partial: Partial<SessionListRenderableSession> = {}): SessionListRenderableSession {
    return {
        id: 's1',
        seq: 1,
        createdAt: 100,
        updatedAt: 100,
        meaningfulActivityAt: 650_000,
        active: false,
        activeAt: 0,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: null,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        ...partial,
    };
}

describe('readSessionListUpdatedOrderingKey', () => {
    it('falls back to the default bucket size when the provided bucket size truncates below one millisecond', () => {
        expect(readSessionListUpdatedOrderingKey(makeRow(), 0.5)).toEqual({
            bucket: Math.floor(650_000 / SESSION_LIST_UPDATED_ORDERING_BUCKET_MS),
            createdAtSecondary: 100,
        });
    });
});
