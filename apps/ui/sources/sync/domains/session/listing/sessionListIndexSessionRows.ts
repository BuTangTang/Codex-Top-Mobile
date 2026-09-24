import type { SessionListIndexItem } from './sessionListIndex';
import type { SessionListRenderableSession } from './sessionListRenderable';
import { normalizeTrimmedString } from './normalizeTrimmedString';

export type ResolveSessionListIndexRow = (
    serverId: string | null | undefined,
    sessionId: string,
) => SessionListRenderableSession | null;

export function resolveSessionRowForIndexItem(
    item: Extract<SessionListIndexItem, { type: 'session' }>,
    resolveSessionRow: ResolveSessionListIndexRow,
): SessionListRenderableSession | null {
    const sessionId = normalizeTrimmedString(item.sessionId);
    if (!sessionId) return null;
    const serverId = normalizeTrimmedString(item.serverId) || null;
    return resolveSessionRow(serverId, sessionId);
}
