import type { DirectTranscriptRawMessageV1 } from '@happier-dev/protocol';

import { classifyOpenCodeMessageForProjection, extractOpenCodeProjectedText } from '../transcriptProjection';

export function mapOpenCodeMessageToDirectItem(message: unknown, index: number): DirectTranscriptRawMessageV1 | null {
  const fallbackId = `opencode:${Math.max(0, Math.trunc(index))}`;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return {
      id: fallbackId,
      localId: fallbackId,
      createdAtMs: 0,
      raw: {
        role: 'agent',
        content: {
          type: 'output',
          data: {
            type: 'opaque',
            reason: 'invalid_message',
            original: message,
          },
        },
      },
    };
  }
  const rec = message as Record<string, unknown>;
  const projection = classifyOpenCodeMessageForProjection(rec);
  if (projection.kind !== 'user_transcript' && projection.kind !== 'assistant_transcript') return null;

  const stableId = projection.messageId || fallbackId;
  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  const contentText = typeof rec.content === 'string' ? rec.content : '';
  const text = contentText || extractOpenCodeProjectedText(parts, { context: 'direct_transcript' });
  if (!text) return null;

  if (projection.kind === 'user_transcript') {
    return {
      id: stableId,
      localId: stableId,
      createdAtMs: projection.createdAtMs,
      raw: {
        role: 'user',
        content: { type: 'text', text },
      },
    };
  }

  return {
    id: stableId,
    localId: stableId,
    createdAtMs: projection.createdAtMs,
    raw: {
      role: 'agent',
      content: { type: 'acp', provider: 'opencode', data: { type: 'message', message: text } },
    },
  };
}
