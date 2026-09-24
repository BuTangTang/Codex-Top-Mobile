import type { CapturedEvent } from './socketClient';

export type DirectSessionTranscriptDeltaItem = {
  id: string;
  createdAtMs: number;
  localId?: string | null;
  raw: Record<string, unknown>;
};

export type DirectSessionTranscriptDeltaPayload = {
  type: 'direct-session-transcript-delta';
  sessionId: string;
  items: DirectSessionTranscriptDeltaItem[];
  fromCursor?: string | null;
  nextCursor?: string | null;
  truncated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readDirectTranscriptDeltaItem(value: unknown): DirectSessionTranscriptDeltaItem | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  const createdAtMs = value.createdAtMs;
  const localId = value.localId;
  const raw = value.raw;

  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof createdAtMs !== 'number' || !Number.isFinite(createdAtMs)) return null;
  if (!(localId === undefined || localId === null || typeof localId === 'string')) return null;
  if (!isRecord(raw)) return null;

  return {
    id,
    createdAtMs,
    ...(localId === undefined ? {} : { localId }),
    raw,
  };
}

function readDirectSessionTranscriptDeltaPayload(value: unknown): DirectSessionTranscriptDeltaPayload | null {
  if (!isRecord(value)) return null;
  if (value.type !== 'direct-session-transcript-delta') return null;
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) return null;
  if (!Array.isArray(value.items)) return null;
  if (typeof value.truncated !== 'boolean') return null;

  const items: DirectSessionTranscriptDeltaItem[] = [];
  for (const valueItem of value.items) {
    const item = readDirectTranscriptDeltaItem(valueItem);
    if (!item) return null;
    items.push(item);
  }

  const nextCursor = value.nextCursor;
  if (!(nextCursor === undefined || nextCursor === null || typeof nextCursor === 'string')) return null;
  const fromCursor = value.fromCursor;
  if (!(fromCursor === undefined || fromCursor === null || typeof fromCursor === 'string')) return null;
  const hasNextCursor = Object.prototype.hasOwnProperty.call(value, 'nextCursor');
  if (value.truncated !== true && hasNextCursor && (typeof fromCursor !== 'string' || fromCursor.length === 0)) {
    return null;
  }

  return {
    type: 'direct-session-transcript-delta',
    sessionId: value.sessionId,
    items,
    ...(fromCursor !== undefined ? { fromCursor } : {}),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    truncated: value.truncated,
  };
}

export function createDirectSessionTranscriptDeltaPayload(params: {
  sessionId: string;
  itemId: string;
  localId: string;
  fromCursor?: string | null;
  nextCursor?: string | null;
  truncated?: boolean;
  createdAtMs?: number;
}): DirectSessionTranscriptDeltaPayload {
  const hasNextCursor = Object.prototype.hasOwnProperty.call(params, 'nextCursor');
  if (
    params.truncated !== true
    && hasNextCursor
    && (typeof params.fromCursor !== 'string' || params.fromCursor.length === 0)
  ) {
    throw new Error('fromCursor is required when nextCursor is present on non-truncated direct-session transcript deltas');
  }
  const payload: DirectSessionTranscriptDeltaPayload = {
    type: 'direct-session-transcript-delta',
    sessionId: params.sessionId,
    items: [
      {
        id: params.itemId,
        localId: params.localId,
        createdAtMs: params.createdAtMs ?? Date.now(),
        raw: {
          provider: 'e2e',
          kind: 'assistant-message',
          text: 'live direct-session transcript delta',
        },
      },
    ],
    truncated: params.truncated ?? false,
  };
  if (params.fromCursor !== undefined) {
    payload.fromCursor = params.fromCursor;
  }
  if (hasNextCursor) {
    payload.nextCursor = params.nextCursor ?? null;
  }
  return payload;
}

export function findDirectSessionTranscriptDeltaEvent(
  events: CapturedEvent[],
  params: { sessionId: string; itemId: string },
): DirectSessionTranscriptDeltaPayload | null {
  for (const event of events) {
    if (event.kind !== 'ephemeral') continue;
    const payload = readDirectSessionTranscriptDeltaPayload(event.payload);
    if (!payload) continue;
    if (payload.sessionId !== params.sessionId) continue;
    if (!payload.items.some((item) => item.id === params.itemId)) continue;
    return payload;
  }
  return null;
}

export function hasRawDirectSessionTranscriptDeltaEvent(
  events: CapturedEvent[],
  params: { sessionId: string; itemId: string },
): boolean {
  return events.some((event) => {
    if (event.kind !== 'ephemeral') return false;
    const payload = event.payload;
    if (!isRecord(payload)) return false;
    if (payload.type !== 'direct-session-transcript-delta') return false;
    if (payload.sessionId !== params.sessionId) return false;
    if (!Array.isArray(payload.items)) return false;
    return payload.items.some((item) => isRecord(item) && item.id === params.itemId);
  });
}
