import { describe, expect, it } from 'vitest';

import {
  createDirectSessionTranscriptDeltaPayload,
  findDirectSessionTranscriptDeltaEvent,
} from './directSessionTranscriptDeltaEvents';

describe('directSessionTranscriptDeltaEvents testkit', () => {
  it('creates cursor-advancing deltas with the source cursor', () => {
    const params: Parameters<typeof createDirectSessionTranscriptDeltaPayload>[0] & { fromCursor: string } = {
      sessionId: 'sess-1',
      itemId: 'direct-1',
      localId: 'local-1',
      fromCursor: 'cursor-1',
      nextCursor: 'cursor-2',
    };

    const payload = createDirectSessionTranscriptDeltaPayload(params);

    expect(payload.fromCursor).toBe('cursor-1');
    expect(payload.nextCursor).toBe('cursor-2');
  });

  it('does not treat cursor-advancing deltas without fromCursor as valid captured events', () => {
    const payload = findDirectSessionTranscriptDeltaEvent([
      {
        at: Date.now(),
        kind: 'ephemeral',
        payload: {
          type: 'direct-session-transcript-delta',
          sessionId: 'sess-1',
          items: [
            {
              id: 'direct-1',
              createdAtMs: 1_000,
              raw: { provider: 'e2e', kind: 'assistant-message' },
            },
          ],
          nextCursor: 'cursor-2',
          truncated: false,
        },
      },
    ], { sessionId: 'sess-1', itemId: 'direct-1' });

    expect(payload).toBeNull();
  });
});
