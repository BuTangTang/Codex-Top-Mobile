import { Socket } from "socket.io";
import { AsyncLock } from "@/utils/runtime/lock";
import { buildUsageEphemeral, eventRouter } from "@/app/events/eventRouter";
import { log } from "@/utils/logging/log";
import { recordUsageReportForAccount } from "@/app/usage/usageReportWriteService";

export function usageHandler(userId: string, socket: Socket) {
    const receiveUsageLock = new AsyncLock();
    socket.on('usage-report', async (data: any, callback?: (response: any) => void) => {
        await receiveUsageLock.inLock(async () => {
            try {
                const { key, sessionId, tokens, cost } = data;

                // Validate required fields
                if (!key || typeof key !== 'string') {
                    if (callback) {
                        callback({ success: false, error: 'Invalid key' });
                    }
                    return;
                }

                // Validate tokens and cost objects
                if (!tokens || typeof tokens !== 'object' || typeof tokens.total !== 'number') {
                    if (callback) {
                        callback({ success: false, error: 'Invalid tokens object - must include total' });
                    }
                    return;
                }

                if (!cost || typeof cost !== 'object' || typeof cost.total !== 'number') {
                    if (callback) {
                        callback({ success: false, error: 'Invalid cost object - must include total' });
                    }
                    return;
                }

                // Validate sessionId if provided
                if (sessionId && typeof sessionId !== 'string') {
                    if (callback) {
                        callback({ success: false, error: 'Invalid sessionId' });
                    }
                    return;
                }

                try {
                    const result = await recordUsageReportForAccount({
                        userId,
                        key,
                        sessionId: sessionId || null,
                        tokens,
                        cost,
                    });
                    if (!result.ok) {
                        if (callback) {
                            callback({ success: false, error: 'Session not found' });
                        }
                        return;
                    }

                    if (result.changed) {
                        log({ module: 'websocket' }, `Usage report saved: key=${key}, sessionId=${sessionId || 'none'}, userId=${userId}`);
                    }

                    // Emit usage ephemeral update if sessionId is provided
                    if (sessionId && result.changed) {
                        const usageEvent = buildUsageEphemeral(sessionId, key, result.usageData.tokens, result.usageData.cost);
                        eventRouter.emitEphemeral({
                            userId,
                            payload: usageEvent,
                            recipientFilter: { type: 'user-scoped-only' }
                        });
                    }

                    if (callback) {
                        callback({
                            success: true,
                            reportId: result.report.id,
                            createdAt: result.report.createdAt.getTime(),
                            updatedAt: result.report.updatedAt.getTime()
                        });
                    }
                } catch (error) {
                    log({ module: 'websocket', level: 'error' }, `Failed to save usage report: ${error}`);
                    if (callback) {
                        callback({ success: false, error: 'Failed to save usage report' });
                    }
                }
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in usage-report handler: ${error}`);
                if (callback) {
                    callback({ success: false, error: 'Internal error' });
                }
            }
        });
    });
}
