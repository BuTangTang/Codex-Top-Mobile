import { apiSocket } from '@/sync/api/session/apiSocket';
import type { UpdateMetadataAck } from '@/sync/domains/session/metadata/updateSessionMetadataWithRetry';
import { raceSocketIoAckTimeout } from '@/sync/runtime/socketIoAckTimeout';

import { createEphemeralServerSocketClient } from './createEphemeralServerSocketClient';
import { resolvePreferredServerIdForSessionId } from './resolvePreferredServerIdForSessionId';
import { resolveServerScopedSessionContext } from './resolveServerScopedSessionContext';

export async function emitSessionMetadataUpdateWithServerScope(params: Readonly<{
    sessionId: string;
    expectedVersion: number;
    metadata: string;
    serverId?: string | null;
    timeoutMs?: number;
}>): Promise<UpdateMetadataAck> {
    const context = await resolveServerScopedSessionContext({
        serverId: typeof params.serverId === 'string' && params.serverId.trim().length > 0
            ? params.serverId.trim()
            : resolvePreferredServerIdForSessionId(params.sessionId),
        timeoutMs: params.timeoutMs,
    });
    const payload = {
        sid: params.sessionId,
        expectedVersion: params.expectedVersion,
        metadata: params.metadata,
    };

    if (context.scope === 'active') {
        return await apiSocket.emitWithAck<UpdateMetadataAck>('update-metadata', payload, { timeoutMs: context.timeoutMs });
    }

    const socket = await createEphemeralServerSocketClient({
        serverUrl: context.targetServerUrl,
        token: context.token,
        timeoutMs: context.timeoutMs,
    });
    try {
        return await raceSocketIoAckTimeout(
            socket.timeout(context.timeoutMs).emitWithAck('update-metadata', payload) as Promise<UpdateMetadataAck>,
            context.timeoutMs,
        );
    } finally {
        socket.disconnect();
    }
}
