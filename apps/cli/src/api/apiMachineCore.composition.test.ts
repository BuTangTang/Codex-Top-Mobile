import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { RPC_ERROR_CODES, RPC_METHODS } from '@happier-dev/protocol/rpc';

import { createApiSessionSocketStub, type ApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import type { Machine } from './types';
import type { ApiMachineClientCore } from './apiMachineCore';

const { ioMock, httpGet, httpPost } = vi.hoisted(() => ({
    ioMock: vi.fn(),
    httpGet: vi.fn(async () => ({ status: 200, data: { id: 'synthetic-account', machine: null, changes: [], nextCursor: 0 } })),
    httpPost: vi.fn(async () => ({ status: 200, data: { success: true } })),
}));

// 只替换真实网络边界；连接 supervisor、加密、RPC manager 与生命周期均用正式实现。
vi.mock('socket.io-client', () => ({ io: ioMock }));
vi.mock('axios', async (importOriginal) => {
    const actual = await importOriginal<typeof import('axios')>();
    return { ...actual, default: { ...actual.default, get: httpGet, post: httpPost } };
});

/** 创建固定密钥的合成机器，避免读取真实账号和记录。 */
function createMachine(): Machine {
    return { id: 'synthetic-machine', encryptionKey: new Uint8Array(32).fill(7), encryptionVariant: 'legacy',
        metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0 };
}

/** 在 socket 边界记录真实注册与状态发布，并按用例选择是否回送 ACK。 */
function createBoundarySocket(id: string, autoAck = false) {
    const registrations: string[] = [];
    const states: unknown[] = [];
    const socket = createApiSessionSocketStub({ id, disconnectReason: 'transport close',
        emit: (event, args, current) => {
            if (event !== SOCKET_RPC_EVENTS.REGISTER) return;
            const method = (args[0] as { method: string }).method;
            registrations.push(method);
            if (autoAck) queueMicrotask(() => current.trigger(SOCKET_RPC_EVENTS.REGISTERED, { method }));
        },
        emitWithAck: (event, payload) => {
            if (event === 'machine-update-state') {
                const request = payload as { daemonState: string };
                states.push(payload);
                return { result: 'success', version: states.length, daemonState: request.daemonState };
            }
            return { ok: true };
        },
    });
    return { socket, registrations, states };
}

/** 加密合成请求并交给正式 RPC listener，验证机器作用域和实际响应。 */
async function sendRequest(socket: ApiSessionSocketStub, method: string, value: unknown, extra = {}) {
    const { encodeBase64, encrypt } = await import('./encryption');
    const machine = createMachine();
    return await new Promise<unknown>((resolve) => socket.trigger(SOCKET_RPC_EVENTS.REQUEST,
        { method: `${machine.id}:${method}`, params: encodeBase64(encrypt(machine.encryptionKey, machine.encryptionVariant, value)), ...extra }, resolve));
}

describe('ApiMachineClientCore real composition boundary', () => {
    const clients: ApiMachineClientCore[] = [];

    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('HAPPIER_SERVER_URL', 'https://relay.example.test');
        vi.stubEnv('HAPPY_ENABLE_V2_CHANGES', 'false');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: {}, capabilities: {} }), { status: 200 })));
        ioMock.mockReset();
        httpGet.mockClear(); httpPost.mockClear();
    });

    afterEach(async () => {
        await Promise.all(clients.splice(0).map((client) => client.shutdown()));
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('rejects an empty readiness contract before opening a transport', async () => {
        const { ApiMachineClientCore } = await import('./apiMachineCore');
        expect(() => new ApiMachineClientCore('synthetic-token', createMachine(), undefined,
            { requiredRpcMethods: [] })).toThrow('Machine RPC composition requires at least one required method');
        expect(ioMock).not.toHaveBeenCalled();
    });

    it('registers only injected methods on the encrypted machine scope and waits for their real ACK', async () => {
        const { ApiMachineClientCore } = await import('./apiMachineCore');
        const { decodeBase64, decrypt } = await import('./encryption');
        const boundary = createBoundarySocket('core-one'); ioMock.mockReturnValue(boundary.socket);
        const machine = createMachine();
        const client = new ApiMachineClientCore('synthetic-token', machine, undefined,
            { requiredRpcMethods: ['synthetic.required'] }); clients.push(client);
        client.registerRpcHandlers(({ rpcHandlerManager }) => {
            rpcHandlerManager.registerHandler('synthetic.required', async (data) => ({ echoed: data }));
            return { dispose: async () => {} };
        });
        client.connect();
        await vi.waitFor(() => expect(boundary.registrations).toEqual(['synthetic-machine:synthetic.required']));
        expect(boundary.states).toEqual([]);
        boundary.socket.trigger(SOCKET_RPC_EVENTS.REGISTERED, { method: boundary.registrations[0] });
        await vi.waitFor(() => expect(boundary.states).toHaveLength(1));
        const response = await sendRequest(boundary.socket, 'synthetic.required', { value: 'synthetic' });
        expect(decrypt(machine.encryptionKey, machine.encryptionVariant, decodeBase64(response as string)))
            .toEqual({ echoed: { value: 'synthetic' } });
    });

    it('does not publish running when the selected profile has a missing required method', async () => {
        const { ApiMachineClientCore } = await import('./apiMachineCore');
        const boundary = createBoundarySocket('core-missing', true); ioMock.mockReturnValue(boundary.socket);
        const client = new ApiMachineClientCore('synthetic-token', createMachine(), undefined,
            { requiredRpcMethods: ['synthetic.required', 'synthetic.missing'] }); clients.push(client);
        client.registerRpcHandlers(({ rpcHandlerManager }) => {
            rpcHandlerManager.registerHandler('synthetic.required', async () => ({ ok: true }));
            return { dispose: async () => {} };
        });
        let connected = false; client.connect({ onConnect: () => { connected = true; } });
        await vi.waitFor(() => expect(connected).toBe(true));
        expect(boundary.states).toEqual([]);
    });

    it('requires new transport acknowledgements and ignores a prior socket ACK after reconnect', async () => {
        const { ApiMachineClientCore } = await import('./apiMachineCore');
        const first = createBoundarySocket('core-before', true), second = createBoundarySocket('core-after');
        ioMock.mockReturnValueOnce(first.socket).mockReturnValue(second.socket);
        const client = new ApiMachineClientCore('synthetic-token', createMachine(), undefined,
            { requiredRpcMethods: ['synthetic.required'] }); clients.push(client);
        client.registerRpcHandlers(({ rpcHandlerManager }) => {
            rpcHandlerManager.registerHandler('synthetic.required', async () => ({ ok: true }));
            return { dispose: async () => {} };
        });
        let connected = 0;
        client.connect({ onConnect: () => { connected++; } });
        await vi.waitFor(() => expect(connected).toBe(1));
        expect(first.states).toHaveLength(1);
        first.socket.disconnect();
        await vi.waitFor(() => expect(second.registrations).toEqual(['synthetic-machine:synthetic.required']), { timeout: 5000 });
        first.socket.trigger(SOCKET_RPC_EVENTS.REGISTERED, { method: 'synthetic-machine:synthetic.required' });
        expect(second.states).toEqual([]);
        second.socket.trigger(SOCKET_RPC_EVENTS.REGISTERED, { method: 'synthetic-machine:synthetic.required' });
        await vi.waitFor(() => expect(second.states).toHaveLength(1));
    });

    it('keeps write authorization and waits for in-flight handlers before disposing the injected lifecycle', async () => {
        const { ApiMachineClientCore } = await import('./apiMachineCore');
        const { decodeBase64, decrypt } = await import('./encryption');
        const boundary = createBoundarySocket('core-idle', true); ioMock.mockReturnValue(boundary.socket);
        const machine = createMachine();
        const client = new ApiMachineClientCore('synthetic-token', machine, undefined,
            { requiredRpcMethods: ['synthetic.required'] }); clients.push(client);
        let finish!: () => void, started = false, disposed = false, stopCalls = 0;
        const pending = new Promise<void>((resolve) => { finish = resolve; });
        client.registerRpcHandlers(({ rpcHandlerManager }) => {
            rpcHandlerManager.registerHandler('synthetic.required', async () => { started = true; await pending; return { ok: true }; });
            rpcHandlerManager.registerHandler(RPC_METHODS.STOP_SESSION, async () => { stopCalls++; return { status: 'stopped' }; });
            return { dispose: async () => { disposed = true; } };
        });
        client.connect(); await vi.waitFor(() => expect(boundary.states).toHaveLength(1));
        const denied = await sendRequest(boundary.socket, RPC_METHODS.STOP_SESSION, { sessionId: 'synthetic-session' }, { transportResponseEnvelopeVersion: 1 });
        const encrypted = (denied as { result: string }).result;
        expect(decrypt(machine.encryptionKey, machine.encryptionVariant, decodeBase64(encrypted))).toMatchObject({ errorCode: RPC_ERROR_CODES.FORBIDDEN });
        expect(stopCalls).toBe(0);
        const request = sendRequest(boundary.socket, 'synthetic.required', {});
        await vi.waitFor(() => expect(started).toBe(true));
        const shutdown = client.shutdown();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(disposed).toBe(false);
        finish(); await request; await shutdown;
        expect(disposed).toBe(true);
    });

    it('reconciles the selected direct owner and removes its update subscription before disposal', async () => {
        const { ApiMachineClientCore } = await import('./apiMachineCore');
        const boundary = createBoundarySocket('core-follow', true); ioMock.mockReturnValue(boundary.socket);
        const client = new ApiMachineClientCore('synthetic-token', createMachine(), undefined,
            { requiredRpcMethods: ['synthetic.required'] }); clients.push(client);
        const reconciled: Array<string | undefined> = [];
        const lifecycleEvents: string[] = [];
        let suspended = 0, lifecycleAtDisposal: string[] | undefined;
        // 只观察公共订阅的取消回调；实际监听集合和事件分发仍由原方法管理。
        const subscribeToConnection = client.onConnectionStateChange.bind(client);
        vi.spyOn(client, 'onConnectionStateChange').mockImplementation((listener) => {
            const unsubscribe = subscribeToConnection(listener);
            return () => { lifecycleEvents.push('off-connection'); unsubscribe(); };
        });
        const subscribeToUpdate = client.onUpdate.bind(client);
        vi.spyOn(client, 'onUpdate').mockImplementation((listener) => {
            const unsubscribe = subscribeToUpdate(listener);
            return () => { lifecycleEvents.push('off-update'); unsubscribe(); };
        });
        const update = (body: unknown) => boundary.socket.trigger('update',
            { id: 'synthetic-update', seq: 1, createdAt: 1, body });
        client.registerRpcHandlers(({ rpcHandlerManager }) => {
            rpcHandlerManager.registerHandler('synthetic.required', async () => ({ ok: true }));
            return {
                directSessions: {
                    reconcile: async (sessionId) => { reconciled.push(sessionId); },
                    suspend: async () => { suspended++; },
                },
                dispose: async () => {
                    lifecycleAtDisposal = [...lifecycleEvents];
                    lifecycleEvents.push('owner-dispose');
                },
            };
        }, { reconcileDirectSessions: true });
        expect(suspended).toBe(1);
        let connected = false; client.connect({ onConnect: () => { connected = true; } });
        await vi.waitFor(() => expect(connected).toBe(true));
        expect(reconciled).toContain(undefined);
        update({ t: 'new-session', id: 'synthetic-new' });
        update({ t: 'update-session', id: 'synthetic-metadata', metadata: { value: 'synthetic' } });
        update({ t: 'update-session', id: 'synthetic-state-only', daemonState: { value: 'synthetic' } });
        update({ t: 'delete-session', sid: 'synthetic-deleted' });
        expect(reconciled.filter((sessionId) => sessionId !== undefined))
            .toEqual(['synthetic-new', 'synthetic-metadata', 'synthetic-deleted']);
        await client.shutdown();
        expect(lifecycleAtDisposal).toEqual(['off-connection', 'off-update']);
        expect(lifecycleEvents).toEqual(['off-connection', 'off-update', 'owner-dispose']);
    });
});
