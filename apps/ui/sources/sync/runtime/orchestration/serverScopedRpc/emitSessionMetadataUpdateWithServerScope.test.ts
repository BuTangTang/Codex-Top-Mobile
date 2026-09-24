import { afterEach, describe, expect, it, vi } from 'vitest';

const emitWithAckSpy = vi.hoisted(() => vi.fn());
const getActiveServerSnapshotSpy = vi.hoisted(() => vi.fn());
const resolvePreferredServerIdForSessionIdSpy = vi.hoisted(() => vi.fn());
const resolveContextSpy = vi.hoisted(() => vi.fn());
const createSocketSpy = vi.hoisted(() => vi.fn());

vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: {
        emitWithAck: (...args: unknown[]) => emitWithAckSpy(...args),
    },
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: (...args: unknown[]) => getActiveServerSnapshotSpy(...args),
}));

vi.mock('./resolvePreferredServerIdForSessionId', () => ({
    resolvePreferredServerIdForSessionId: (sessionId: string) => resolvePreferredServerIdForSessionIdSpy(sessionId),
}));

vi.mock('./resolveServerScopedSessionContext', () => ({
    resolveServerScopedSessionContext: (params: unknown) => resolveContextSpy(params),
}));

vi.mock('./createEphemeralServerSocketClient', () => ({
    createEphemeralServerSocketClient: (params: unknown) => createSocketSpy(params),
}));

describe('emitSessionMetadataUpdateWithServerScope', () => {
    afterEach(() => {
        emitWithAckSpy.mockReset();
        getActiveServerSnapshotSpy.mockReset();
        resolvePreferredServerIdForSessionIdSpy.mockReset();
        resolveContextSpy.mockReset();
        createSocketSpy.mockReset();
        vi.useRealTimers();
    });

    it('uses the active socket when the preferred owner server is active', async () => {
        resolvePreferredServerIdForSessionIdSpy.mockReturnValue('server-a');
        getActiveServerSnapshotSpy.mockReturnValue({ serverId: 'server-a' });
        resolveContextSpy.mockResolvedValue({ scope: 'active', timeoutMs: 4000 });
        emitWithAckSpy.mockResolvedValue({ result: 'success' });

        const { emitSessionMetadataUpdateWithServerScope } = await import('./emitSessionMetadataUpdateWithServerScope');

        const result = await emitSessionMetadataUpdateWithServerScope({
            sessionId: 'session-1',
            expectedVersion: 3,
            metadata: 'ciphertext',
            timeoutMs: 4000,
        });

        expect(result).toEqual({ result: 'success' });
        expect(resolveContextSpy).toHaveBeenCalledWith({ serverId: 'server-a', timeoutMs: 4000 });
        expect(emitWithAckSpy).toHaveBeenCalledWith('update-metadata', {
            sid: 'session-1',
            expectedVersion: 3,
            metadata: 'ciphertext',
        }, {
            timeoutMs: 4000,
        });
        expect(createSocketSpy).not.toHaveBeenCalled();
    });

    it('rejects an active metadata update when the ack never settles before the resolved timeout', async () => {
        vi.useFakeTimers();
        resolvePreferredServerIdForSessionIdSpy.mockReturnValue('server-a');
        getActiveServerSnapshotSpy.mockReturnValue({ serverId: 'server-a' });
        resolveContextSpy.mockResolvedValue({ scope: 'active', timeoutMs: 10 });
        emitWithAckSpy.mockImplementation((_event: string, _payload: unknown, opts?: { timeoutMs?: number }) => {
            if (typeof opts?.timeoutMs !== 'number') {
                return new Promise<never>(() => {});
            }
            return new Promise((_resolve, reject) => {
                setTimeout(() => reject(new Error(`Socket.io ack timeout after ${opts.timeoutMs}ms`)), opts.timeoutMs);
            });
        });

        const { emitSessionMetadataUpdateWithServerScope } = await import('./emitSessionMetadataUpdateWithServerScope');

        const promise = emitSessionMetadataUpdateWithServerScope({
            sessionId: 'session-1',
            expectedVersion: 3,
            metadata: 'ciphertext',
            timeoutMs: 10,
        });
        const observed = promise.then(
            () => 'resolved' as const,
            (error) => error,
        );
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(11);
        await Promise.resolve();
        const settled = await Promise.race([
            observed,
            Promise.resolve('pending' as const),
        ]);

        expect(settled).toBeInstanceOf(Error);
        expect(settled).toMatchObject({ message: 'Socket.io ack timeout after 10ms' });
    });

    it('uses an ephemeral scoped socket when the preferred owner server differs from active', async () => {
        resolvePreferredServerIdForSessionIdSpy.mockReturnValue('server-b');
        getActiveServerSnapshotSpy.mockReturnValue({ serverId: 'server-a' });
        resolveContextSpy.mockResolvedValue({
            scope: 'scoped',
            targetServerId: 'server-b',
            targetServerUrl: 'https://server-b.example.test',
            token: 'token-b',
            timeoutMs: 5000,
            encryption: null,
        });
        const emitWithAck = vi.fn(async () => ({ result: 'success', version: 4 }));
        const disconnect = vi.fn();
        createSocketSpy.mockResolvedValue({
            timeout: vi.fn(() => ({ emitWithAck })),
            disconnect,
        });

        const { emitSessionMetadataUpdateWithServerScope } = await import('./emitSessionMetadataUpdateWithServerScope');

        const result = await emitSessionMetadataUpdateWithServerScope({
            sessionId: 'session-1',
            expectedVersion: 3,
            metadata: 'ciphertext',
            timeoutMs: 5000,
        });

        expect(result).toEqual({ result: 'success', version: 4 });
        expect(resolveContextSpy).toHaveBeenCalledWith({ serverId: 'server-b', timeoutMs: 5000 });
        expect(createSocketSpy).toHaveBeenCalledWith({
            serverUrl: 'https://server-b.example.test',
            token: 'token-b',
            timeoutMs: 5000,
        });
        expect(emitWithAck).toHaveBeenCalledWith('update-metadata', {
            sid: 'session-1',
            expectedVersion: 3,
            metadata: 'ciphertext',
        });
        expect(disconnect).toHaveBeenCalledTimes(1);
    });
});
