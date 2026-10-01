import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 日志是外部文件输出边界，测试不写实际诊断目录；真实 IPC 行为仍被覆盖。
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), infoFile: vi.fn() } }));

import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { writeProtectedLocalStateFileAtomic } from '@/utils/fs/protectedLocalState';

const environment = vi.hoisted(() => ({ activeServerDir: '', filesUploadMaxFileBytes: 50 * 1024 * 1024 }));
// 配置是环境边界；内部去重、文件持久化和 IPC 解析都执行真实实现。
vi.mock('@/configuration', () => ({ configuration: environment }));
// 只替换操作系统启动边界；owner 发现、元数据校验和快照均执行实际实现。
vi.mock('node:child_process', async (importOriginal) => ({
    ...await importOriginal<typeof import('node:child_process')>(), execFile: vi.fn(),
}));

import { getDesktopSessionControl, getDesktopSessionControlSnapshot, sendDesktopSessionUserMessage, performDesktopSessionControlAction } from './desktopSessionControl';
import { readDesktopControlSnapshot } from './desktopControlSnapshot';
import { DesktopIpc, DesktopIpcError } from './desktopIpc';
import { openDesktopSession } from './openDesktopSession';

type Request = {
    type: string;
    requestId: string;
    method: string;
    version: number;
    sourceClientId: string;
    targetClientId?: string;
    hostId?: string;
    timeoutMs?: number;
    params: Record<string, unknown>;
};

// 合成帧依据 Desktop 26.917.51856 (10492) 的 src-mOb8On4V.js / main-9ZiZs9Y1.js。
// 它验证已观察的方法版本与结构，不将安装版本冒充正在运行 owner 的认证。
describe('Desktop-owned session control', () => {
    let root: string;
    let codexHome: string;
    const servers = new Set<Server>();
    let requests: Request[];
    const sockets = new Set<Socket>();
    let onInitialize: (request: Request, socket: Socket) => void;
    let onStart: (request: Request, socket: Socket) => void;
    let onDiscover: (request: Request, socket: Socket) => void;
    let onFollow: (request: Request, socket: Socket) => void;
    let onHistory: (request: Request, socket: Socket) => void;
    const snapshotRevisions = new Map<Socket, number>();
    let onAction: (request: Request, socket: Socket) => void;
    const input = { remoteSessionId: 'thread-synthetic', text: 'synthetic prompt', localId: 'message-synthetic', accountId: 'account-synthetic' };
    const openId = '01a0d20c-5a82-7ea1-86b9-16c6eb50c1c9';
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

    /** 保存有明确原生 ID 的合成首行，不读取或修改任何真实任务。 */
    async function writeOpenTarget(id = openId, home = codexHome): Promise<void> {
        await mkdir(join(home, 'sessions'), { recursive: true });
        await writeFile(join(home, 'sessions', `rollout-${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id } }) + '\n');
    }

    /** 用原协议的明确拒绝模拟尚未加载、没有 owner 的任务。 */
    function missingOwner(request: Request, socket: Socket): void {
        respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'error', error: 'no-client-found' });
    }

    /** 独立编码外部协议帧，让单次 write 可以重现同一批内的 owner 失联。 */
    function frame(value: unknown): Buffer {
        const body = Buffer.from(JSON.stringify(value));
        const header = Buffer.alloc(4);
        header.writeUInt32LE(body.length);
        return Buffer.concat([header, body]);
    }

    /** 用独立编码的外部边界帧模拟 Desktop，刻意拆分帧头和正文。 */
    function respond(socket: Socket, value: unknown): void {
        const change = (value as { params?: { change?: { type?: string; revision?: number } } })?.params?.change;
        if (change?.type === 'snapshot' && typeof change.revision === 'number') snapshotRevisions.set(socket, change.revision);
        const body = Buffer.from(JSON.stringify(value));
        const header = Buffer.alloc(4);
        header.writeUInt32LE(body.length);
        socket.write(header.subarray(0, 2));
        socket.write(Buffer.concat([header.subarray(2), body]));
    }

    /** 构造当前 Desktop 真实的两层 result 回执，而非仅 socket 写入确认。 */
    function accepted(request: Request, socket: Socket): void {
        respond(socket, {
            type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'owner-synthetic',
            result: { result: { turn: { id: 'turn-synthetic' } } },
        });
    }

    /** 构造固定原 owner 的外部快照帧，供冷开文本及同批断线回归复用。 */
    function controlSnapshotFrame(state: Record<string, unknown>): Record<string, unknown> {
        return { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
            sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: input.remoteSessionId,
                change: { type: 'snapshot', revision: 1, conversationState: state } } };
    }

    /** 静止历史来自原 owner 的明确 idle 快照，不以观察首包已确认作为前提。 */
    function idleControlState(): Record<string, unknown> {
        return { id: input.remoteSessionId, cwd: '/synthetic', threadRuntimeStatus: { type: 'idle' },
            turns: [{ turnId: 'old-turn', status: 'completed', items: [] }], requests: [] };
    }

    /** 只在临时目录启动合成 router，禁止测试接触真实 Codex socket。 */
    async function startRouter(home = codexHome): Promise<void> {
        await mkdir(join(home, 'ipc'), { recursive: true, mode: 0o700 });
        const server = createServer((socket) => {
            sockets.add(socket);
            // 控制拒绝会主动断开；合成服务器只容忍该关闭竞态的传输错误。
            socket.on('error', (error: NodeJS.ErrnoException) => {
                if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') throw error;
            });
            socket.on('close', () => sockets.delete(socket));
            let pending = Buffer.alloc(0);
            // 这里是第三方传输边界，保留实际分帧和并发请求行为。
            socket.on('data', (chunk: Buffer) => {
                pending = Buffer.concat([pending, chunk]);
                while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE(0)) {
                    const size = pending.readUInt32LE(0);
                    const request = JSON.parse(pending.subarray(4, 4 + size).toString()) as Request;
                    pending = pending.subarray(4 + size);
                    requests.push(request);
                    if (request.method === 'initialize') {
                        onInitialize(request, socket);
                    } else if (request.method === 'thread-owner-discovery') {
                        onDiscover(request, socket);
                    } else if (request.method === 'thread-follower-start-turn') {
                        onStart(request, socket);
                    } else if (request.method === 'thread-stream-following-changed') {
                        onFollow(request, socket);
                    } else if (request.method === 'thread-follower-load-complete-history') {
                        onHistory(request, socket);
                    } else if (request.method.startsWith('thread-follower-')) {
                        onAction(request, socket);
                    }
                }
            });
        });
        servers.add(server);
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(join(home, 'ipc', 'ipc.sock'), resolve);
        });
    }

    /** 每例隔离 Happier 意图文件和 Codex 模拟目录。 */
    beforeEach(async () => {
        root = await createTempDir('hcd-');
        codexHome = join(root, 'codex');
        environment.activeServerDir = join(root, 'happier');
        requests = [];
        onInitialize = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'follower-synthetic', result: { clientId: 'follower-synthetic' } });
        vi.mocked(execFile).mockReset();
        snapshotRevisions.clear();
        onHistory = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic',
            result: { revision: snapshotRevisions.get(socket) ?? 1 } });
        onStart = accepted;
        onFollow = (request, socket) => {
            if (request.params.following) respond(socket, controlSnapshotFrame(idleControlState()));
        };
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic', result: { ok: true } });
        onDiscover = (request, socket) => respond(socket, {
            type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'owner-synthetic', result: { supportsUntrustedAppInput: true },
        });
    });

    /** 关闭全部合成连接，避免测试残留句柄或触碰用户进程。 */
    afterEach(async () => {
        Object.defineProperty(process, 'platform', originalPlatform);
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
        servers.clear();
        await removeTempDir(root);
    });

    it.each(['valid', 'revoked'] as const)('checks warm status against the %s current lease without cold discovery', async (mode) => {
        await startRouter();
        const followed = await DesktopIpc.open(codexHome);
        await followed.discoverOwner(input.remoteSessionId);
        await followed.readControlSnapshot(input.remoteSessionId, () => {});
        let reads = 0;
        const getFollowedIpc = () => mode === 'revoked' && ++reads > 1 ? null : followed;
        try {
            const result = await getDesktopSessionControl({ codexHome, remoteSessionId: input.remoteSessionId, getFollowedIpc });
            expect(result).toMatchObject(mode === 'valid' ? { available: true, ownerClientId: 'owner-synthetic' }
                : { available: false, reason: 'owner_changed' });
            expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(1);
            expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(1);
            expect(followed.isClosed()).toBe(false);
        } finally { followed.close(); }
    });

    it.each(['start', 'steer'] as const)('dispatches warm %s on the retained connection before any second history hydration', async (mode) => {
        if (mode === 'steer') onFollow = (request, socket) => {
            if (request.params.following) respond(socket, controlSnapshotFrame({ ...idleControlState(),
                threadRuntimeStatus: { type: 'active' }, turns: [{ turnId: 'old-turn', status: 'inProgress', items: [] }] }));
        };
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic', result: { result: { turnId: 'old-turn' } } });
        await startRouter();
        const followed = await DesktopIpc.open(codexHome);
        await followed.discoverOwner(input.remoteSessionId);
        await followed.readControlSnapshot(input.remoteSessionId, () => {});
        const getFollowedIpc = () => followed;
        // 后续历史永不回执；真正投递仍应使用原连续锚，不能等完整历史超时。
        onHistory = () => {};
        const result = mode === 'start' ? sendDesktopSessionUserMessage({ codexHome, ...input, getFollowedIpc })
            : performDesktopSessionControlAction({ codexHome, ...input, getFollowedIpc, action: {
                machineId: 'machine', sessionId: 'linked', kind: 'steer', operationId: input.localId,
                expectedTurnId: 'old-turn', text: input.text,
            } });
        try {
            await vi.waitFor(() => expect(requests.filter((request) => request.method === `thread-follower-${mode}-turn`)).toHaveLength(1), { timeout: 1000 });
            await expect(result).resolves.toMatchObject({ status: 'accepted' });
            expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(1);
            expect(requests.filter((request) => request.method === 'initialize')).toHaveLength(1);
            expect(followed.isClosed()).toBe(false);
        } finally {
            followed.close();
            for (const socket of sockets) socket.destroy();
            await result;
        }
    });

    it.each(['start', 'steer'] as const)('keeps the real warm %s ACK when a native lifecycle snapshot arrives first', async (mode) => {
        const initial = mode === 'start' ? idleControlState() : { ...idleControlState(),
            threadRuntimeStatus: { type: 'active' }, turns: [{ turnId: 'old-turn', status: 'inProgress', items: [] }] };
        onFollow = (request, socket) => {
            if (request.params.following) respond(socket, controlSnapshotFrame(initial));
        };
        let releaseAck!: () => void;
        const receive = (request: Request, socket: Socket) => {
            // 原生 turn/started 与 turn/completed 会先广播完整 snapshot，再返回请求 ACK。
            const message = controlSnapshotFrame({ ...initial, threadRuntimeStatus: { type: 'active' },
                turns: mode === 'start' ? [...initial.turns as unknown[], { turnId: 'turn-synthetic', status: 'inProgress', items: [] }]
                    : initial.turns });
            (message.params as { change: { revision: number } }).change.revision = 2;
            respond(socket, message);
            releaseAck = () => mode === 'start' ? accepted(request, socket) : respond(socket, {
                type: 'response', requestId: request.requestId, method: request.method,
                resultType: 'success', handledByClientId: 'owner-synthetic', result: { result: { turnId: 'old-turn' } },
            });
        };
        onStart = receive; onAction = receive;
        await startRouter();
        const followed = await DesktopIpc.open(codexHome);
        await followed.discoverOwner(input.remoteSessionId);
        const observation = vi.fn();
        await followed.readControlSnapshot(input.remoteSessionId, observation);
        let settled = false;
        const result = (mode === 'start' ? sendDesktopSessionUserMessage({ codexHome, ...input, getFollowedIpc: () => followed })
            : performDesktopSessionControlAction({ codexHome, ...input, getFollowedIpc: () => followed, action: {
                machineId: 'machine', sessionId: 'linked', kind: 'steer', operationId: input.localId,
                expectedTurnId: 'old-turn', text: input.text,
            } })).finally(() => { settled = true; });
        try {
            await vi.waitFor(() => expect(observation).toHaveBeenCalled());
            // 完整快照不是请求回执；必须继续等待原 requestId/owner 的真实 ACK。
            expect(settled).toBe(false);
            releaseAck();
            await expect(result).resolves.toMatchObject({ status: 'accepted' });
            expect(requests.filter((request) => request.method === `thread-follower-${mode}-turn`)).toHaveLength(1);
            expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(1);
        } finally { followed.close(); await result; }
    });

    it('does not grant a new send from a contiguous native snapshot whose control state is unknown', async () => {
        await startRouter();
        const followed = await DesktopIpc.open(codexHome);
        await followed.discoverOwner(input.remoteSessionId);
        const observation = vi.fn();
        await followed.readControlSnapshot(input.remoteSessionId, observation);
        const state = idleControlState();
        delete state.threadRuntimeStatus;
        const message = controlSnapshotFrame(state);
        (message.params as { change: { revision: number } }).change.revision = 2;
        respond([...sockets][0]!, message);
        try {
            await vi.waitFor(() => expect(observation).toHaveBeenCalled());
            const result = await sendDesktopSessionUserMessage({ codexHome, ...input, getFollowedIpc: () => followed });
            expect(result).toMatchObject({ status: 'rejected' });
            expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(0);
            expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(1);
            expect(followed.isClosed()).toBe(false);
        } finally { followed.close(); }
    });

    it.each(['start', 'steer', 'revoked'] as const)('rejects a warm %s intent when its continuous proof no longer permits it', async (mode) => {
        await startRouter();
        const followed = await DesktopIpc.open(codexHome);
        await followed.discoverOwner(input.remoteSessionId);
        await followed.readControlSnapshot(input.remoteSessionId, () => {});
        const socket = [...sockets][0]!;
        respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
            params: { hostId: 'local', conversationId: input.remoteSessionId, change: { type: 'patches', baseRevision: 1, revision: 2,
                patches: [{ op: 'add', path: ['turns', 1], value: { turnId: 'new-turn', status: 'inProgress', items: [] } },
                    { op: 'replace', path: ['threadRuntimeStatus', 'type'], value: 'active' }] } } });
        await vi.waitFor(() => expect(followed.getControlSnapshot(input.remoteSessionId)?.state).toMatchObject({ turns: [expect.anything(), { turnId: 'new-turn' }] }));
        let reads = 0;
        const getFollowedIpc = () => mode === 'revoked' && ++reads > 1 ? null : followed;
        const result = mode !== 'steer' ? await sendDesktopSessionUserMessage({ codexHome, ...input, getFollowedIpc })
            : await performDesktopSessionControlAction({ codexHome, ...input, getFollowedIpc, action: {
                machineId: 'machine', sessionId: 'linked', kind: 'steer', operationId: input.localId,
                expectedTurnId: 'old-turn', text: input.text,
            } });
        expect(result).toMatchObject({ status: 'rejected', reason: mode === 'start' ? 'turn_not_idle' : mode === 'steer' ? 'turn_changed' : 'owner_changed' });
        expect(requests.filter((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toHaveLength(0);
        expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(1);
        followed.close();
    });

    it('rejects a cold send whose caller is revoked while complete history is pending', async () => {
        let history: { request: Request; socket: Socket } | undefined;
        onHistory = (request, socket) => { history = { request, socket }; };
        await startRouter();
        let revoked = false;
        const result = sendDesktopSessionUserMessage({ codexHome, ...input, getFollowedIpc: () => {
            if (revoked) throw new DesktopIpcError('owner_changed');
            return null;
        } });
        await vi.waitFor(() => expect(history).toBeDefined());
        revoked = true;
        respond(history!.socket, { type: 'response', requestId: history!.request.requestId,
            method: history!.request.method, resultType: 'success', handledByClientId: 'owner-synthetic', result: { revision: 1 } });
        await expect(result).resolves.toMatchObject({ status: 'rejected', reason: 'owner_changed' });
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(0);
    });

    it('opens an unloaded existing task once and then uses the original correlated control path', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        const loaded = onDiscover;
        onDiscover = missingOwner;
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            onDiscover = loaded;
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        onFollow = (request, socket) => {
            if (request.params.following) respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
                sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: openId,
                    change: { type: 'snapshot', revision: 1, conversationState: { ...idleControlState(), id: openId } } } });
        };
        await startRouter();
        const target = { codexHome, remoteSessionId: openId, isCurrent: () => true };
        await Promise.all([openDesktopSession(target), openDesktopSession(target)]);
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(execFile).toHaveBeenCalledWith('/usr/bin/open', ['-b', 'com.openai.codex', `codex://threads/${openId}?hostId=local`],
            expect.objectContaining({ timeout: 2_000 }), expect.any(Function));
        expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(0);
        await expect(getDesktopSessionControlSnapshot(target)).resolves.toMatchObject({ state: 'completed', textSendMode: 'start', requests: [] });
        expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(1);
    });

    it('opens the selected existing task when discovery succeeds before history is loaded', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        let loaded = false;
        const loadedHistory = onHistory;
        onHistory = (request, socket) => loaded ? loadedHistory(request, socket) : missingOwner(request, socket);
        onFollow = (request, socket) => {
            if (request.params.following) respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
                sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: openId,
                    change: { type: 'snapshot', revision: 1, conversationState: { ...idleControlState(), id: openId } } } });
        };
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            loaded = true;
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        await startRouter();
        const target = { codexHome, remoteSessionId: openId, isCurrent: () => true };
        await expect(getDesktopSessionControlSnapshot(target)).rejects.toThrow('owner_unavailable');
        await openDesktopSession(target);
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(execFile).toHaveBeenCalledWith('/usr/bin/open', ['-b', 'com.openai.codex', `codex://threads/${openId}?hostId=local`],
            expect.objectContaining({ timeout: 2_000 }), expect.any(Function));
        await expect(getDesktopSessionControlSnapshot(target)).resolves.toMatchObject({ state: 'completed', textSendMode: 'start', requests: [] });
    });

    it('validates and launches an existing task without an IPC connection in launch-only mode', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        await expect(openDesktopSession({ codexHome, remoteSessionId: openId, isCurrent: () => true, waitForOwner: false }))
            .resolves.toBeUndefined();
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(requests).toHaveLength(0);
        expect(existsSync(join(codexHome, 'ipc'))).toBe(false);
    });

    it('does not make launch-only recovery await a concurrent explicit owner wait', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        let discovery: { request: Request; socket: Socket } | undefined;
        const loaded = onDiscover;
        onDiscover = (request, socket) => { discovery = { request, socket }; };
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        await startRouter();
        const target = { codexHome, remoteSessionId: openId, isCurrent: () => true };
        const waiting = openDesktopSession(target);
        await vi.waitFor(() => expect(discovery).toBeDefined());
        let launched = false;
        const launchOnly = openDesktopSession({ ...target, waitForOwner: false }).then(() => { launched = true; });
        try {
            await vi.waitFor(() => expect(launched).toBe(true), { timeout: 500 });
            expect(execFile).toHaveBeenCalledTimes(2);
            expect(requests.filter((request) => request.method === 'initialize')).toHaveLength(1);
        } finally {
            loaded(discovery!.request, discovery!.socket);
            await Promise.all([waiting, launchOnly]);
        }
    });

    it.each(['../new?prompt=unexpected', 'new', `${openId}?prompt=unexpected`])('rejects a non-task URL target before a launch (%s)', async (remoteSessionId) => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await startRouter();
        await expect(openDesktopSession({ codexHome, remoteSessionId, isCurrent: () => true })).rejects.toThrow('invalid_request');
        expect(execFile).not.toHaveBeenCalled();
        expect(requests).toHaveLength(0);
    });

    it('does not launch an unloaded ID missing from the selected source', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        onDiscover = missingOwner;
        await startRouter();
        await expect(openDesktopSession({ codexHome, remoteSessionId: openId, isCurrent: () => true })).rejects.toThrow('session_not_found');
        expect(execFile).not.toHaveBeenCalled();
    });

    it('does not launch after the initiating account lifecycle has changed', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        onDiscover = missingOwner;
        await startRouter();
        await expect(openDesktopSession({ codexHome, remoteSessionId: openId, isCurrent: () => false })).rejects.toThrow('source_unavailable');
        expect(execFile).not.toHaveBeenCalled();
    });

    it('bounds failed discovery retries and allows only a later explicit click to try opening again', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        onDiscover = missingOwner;
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        await startRouter();
        const target = { codexHome, remoteSessionId: openId, isCurrent: () => true };
        await expect(openDesktopSession(target)).rejects.toThrow('owner_unavailable');
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(2);
        await expect(openDesktopSession(target)).rejects.toThrow('owner_unavailable');
        expect(execFile).toHaveBeenCalledTimes(2);
    });

    it.each(['task', 'source'])('keeps explicit opens independent for different %s targets', async (difference) => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        const secondId = difference === 'task' ? '01a0c6f6-f8ba-7380-8d9b-61f75792fc17' : openId;
        const secondHome = difference === 'source' ? join(root, 'other') : codexHome;
        await writeOpenTarget();
        await writeOpenTarget(secondId, secondHome);
        const loaded = onDiscover;
        onDiscover = missingOwner;
        const completions: Array<(error: Error | null) => void> = [];
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            completions.push(args[3] as (error: Error | null) => void);
            return {} as ReturnType<typeof execFile>;
        });
        await startRouter();
        if (secondHome !== codexHome) await startRouter(secondHome);
        const first = openDesktopSession({ codexHome, remoteSessionId: openId, isCurrent: () => true });
        const second = openDesktopSession({ codexHome: secondHome, remoteSessionId: secondId, isCurrent: () => true });
        try {
            await vi.waitFor(() => expect(completions).toHaveLength(2));
        } finally {
            onDiscover = loaded;
            for (const complete of completions) complete(null);
            await Promise.all([first, second]);
        }
        expect(execFile).toHaveBeenCalledTimes(2);
        expect(vi.mocked(execFile).mock.calls.map((call) => call[1])).toEqual(expect.arrayContaining([
            ['-b', 'com.openai.codex', `codex://threads/${openId}?hostId=local`],
            ['-b', 'com.openai.codex', `codex://threads/${secondId}?hostId=local`],
        ]));
    });

    it('stops after the single operating-system open fails', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        onDiscover = missingOwner;
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            (args[3] as (error: Error | null) => void)(new Error('synthetic launch failure'));
            return {} as ReturnType<typeof execFile>;
        });
        await startRouter();
        await expect(openDesktopSession({ codexHome, remoteSessionId: openId, isCurrent: () => true })).rejects.toThrow('desktop_open_failed');
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(0);
    });

    it('never launches the desktop from ordinary status or control failures', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        onDiscover = missingOwner;
        await startRouter();
        await expect(getDesktopSessionControl({ codexHome, remoteSessionId: openId })).resolves.toMatchObject({ available: false });
        await expect(getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: openId })).rejects.toThrow('owner_unavailable');
        expect(execFile).not.toHaveBeenCalled();
    });

    it('does not invoke the macOS URL launcher on another platform', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        await openDesktopSession({ codexHome, remoteSessionId: openId, isCurrent: () => true });
        expect(execFile).not.toHaveBeenCalled();
        expect(requests).toHaveLength(0);
    });

    it('anchors control to the correlated owner revision instead of the stale first high snapshot', async () => {
        let release!: () => void;
        onFollow = (request, socket) => {
            if (!request.params.following) return;
            for (const [revision, turnId] of [[225, 'stale'], [51, 'current']] as const) {
                const state = { ...idleControlState(), turns: [{ turnId, status: 'completed', items: [] }] };
                const message = controlSnapshotFrame(state);
                (message.params as { change: { revision: number } }).change.revision = revision;
                respond(socket, message);
            }
        };
        onHistory = (request, socket) => { release = () => respond(socket, { type: 'response', requestId: request.requestId,
            method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic', result: { revision: 51 } }); };
        await startRouter();
        let settled = false;
        const result = getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }).finally(() => { settled = true; });
        await vi.waitFor(() => expect(requests.some((request) => request.method === 'thread-stream-following-changed')).toBe(true));
        expect(settled).toBe(false);
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        release();
        expect(await result).toMatchObject({ turnId: 'current' });
        expect(requests.find((request) => request.method === 'thread-follower-load-complete-history'))
            .toMatchObject({ version: 1, targetClientId: 'owner-synthetic', params: { conversationId: input.remoteSessionId } });
    });

    it('anchors a contiguous patch chain at the acknowledged revision without requiring another full snapshot', async () => {
        onHistory = (request, socket) => {
            respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
                params: { hostId: 'local', conversationId: input.remoteSessionId, change: { type: 'patches', baseRevision: 1, revision: 2,
                    patches: [{ op: 'replace', path: ['turns', 0, 'turnId'], value: 'latest-via-patch' }] } } });
            respond(socket, { type: 'response', requestId: request.requestId, method: request.method, resultType: 'success',
                handledByClientId: 'owner-synthetic', result: { revision: 2 } });
        };
        await startRouter();
        await expect(getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }))
            .resolves.toMatchObject({ turnId: 'latest-via-patch' });
        expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(1);
    });

    it('rejects different reachable states at the acknowledged revision instead of preferring the full snapshot', async () => {
        onHistory = (request, socket) => {
            respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
                params: { hostId: 'local', conversationId: input.remoteSessionId, change: { type: 'patches', baseRevision: 1, revision: 2,
                    patches: [{ op: 'replace', path: ['turns', 0, 'turnId'], value: 'from-chain' }] } } });
            const snapshot = controlSnapshotFrame({ ...idleControlState(), turns: [{ turnId: 'from-snapshot', status: 'completed', items: [] }] });
            (snapshot.params as { change: { revision: number } }).change.revision = 2;
            respond(socket, snapshot);
            respond(socket, { type: 'response', requestId: request.requestId, method: request.method, resultType: 'success',
                handledByClientId: 'owner-synthetic', result: { revision: 2 } });
        };
        await startRouter();
        await expect(getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }))
            .rejects.toThrow('invalid_snapshot');
    });

    it.each([false, true])('compares every reachable patch branch at the owner revision (conflict=%s)', async (conflict) => {
        onHistory = (request, socket) => {
            const second = controlSnapshotFrame({ ...idleControlState(), cwd: conflict ? '/conflicting-synthetic' : '/synthetic' });
            (second.params as { change: { revision: number } }).change.revision = 2;
            respond(socket, second);
            for (const baseRevision of [1, 2]) respond(socket, {
                type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
                params: { hostId: 'local', conversationId: input.remoteSessionId, change: { type: 'patches', baseRevision, revision: 3,
                    patches: [{ op: 'replace', path: ['turns', 0, 'turnId'], value: 'same-acknowledged-turn' }] } } });
            respond(socket, { type: 'response', requestId: request.requestId, method: request.method, resultType: 'success',
                handledByClientId: 'owner-synthetic', result: { revision: 3 } });
        };
        await startRouter();
        const result = getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId });
        if (conflict) await expect(result).rejects.toThrow('invalid_snapshot');
        else await expect(result).resolves.toMatchObject({ turnId: 'same-acknowledged-turn' });
    });

    it('rejects conflicting states at the same owner anchor revision before a control decision', async () => {
        onFollow = (request, socket) => {
            if (!request.params.following) return;
            for (const turnId of ['one', 'other']) respond(socket, controlSnapshotFrame({ ...idleControlState(),
                turns: [{ turnId, status: 'completed', items: [] }] }));
        };
        await startRouter();
        await expect(getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }))
            .rejects.toThrow('invalid_snapshot');
        expect(requests.some((request) => request.method === 'thread-follower-start-turn')).toBe(false);
    });

    it.each(['wrong-owner', 'unsupported'])('rejects %s history anchoring without falling back to the first snapshot', async (variant) => {
        onHistory = (request, socket) => respond(socket, variant === 'unsupported'
            ? { type: 'response', requestId: request.requestId, method: request.method, resultType: 'error', error: 'no-handler-for-request' }
            : { type: 'response', requestId: request.requestId, method: request.method, resultType: 'success', handledByClientId: 'other', result: { revision: 1 } });
        await startRouter();
        await expect(getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }))
            .rejects.toThrow(variant === 'unsupported' ? 'incompatible_protocol' : 'invalid_response');
    });

    it('waits for the correlated snapshot when the owner reply arrives first', async () => {
        onFollow = () => {};
        let deliver!: () => void;
        onHistory = (request, socket) => {
            respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
                resultType: 'success', handledByClientId: 'owner-synthetic', result: { revision: 1 } });
            deliver = () => respond(socket, controlSnapshotFrame(idleControlState()));
        };
        await startRouter();
        let settled = false;
        const result = getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }).finally(() => { settled = true; });
        await vi.waitFor(() => expect(deliver).toBeTypeOf('function'));
        expect(settled).toBe(false);
        deliver();
        expect(await result).toMatchObject({ turnId: 'old-turn' });
    });

    it('does not amplify full snapshots into reciprocal history requests between two control reads', async () => {
        const followers = new Set<Socket>();
        let revision = 1;
        let historyRequests = 0;
        onFollow = (request, socket) => {
            if (request.params.following) followers.add(socket); else followers.delete(socket);
        };
        onHistory = (request, socket) => {
            historyRequests++;
            // 仅测试服务端在第六次停止出帧，使有缺陷客户端的反馈回路有界可复现。
            if (historyRequests > 6) return;
            revision++;
            const message = controlSnapshotFrame(idleControlState());
            (message.params as { change: { revision: number } }).change.revision = revision;
            for (const follower of followers) respond(follower, message);
            respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
                resultType: 'success', handledByClientId: 'owner-synthetic', result: { revision } });
        };
        await startRouter();
        await Promise.allSettled([
            getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }),
            getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }),
        ]);
        expect(historyRequests).toBe(2);

    });

    it.each(['patch', 'snapshot', 'conflict', 'gap', 'disconnect'])('checks %s after the anchor ACK in the same incoming batch', async (variant) => {
        onHistory = (request, socket) => {
            const ack = { type: 'response', requestId: request.requestId, method: request.method,
                resultType: 'success', handledByClientId: 'owner-synthetic', result: { revision: 1 } };
            const change = variant === 'snapshot' || variant === 'conflict'
                ? { type: 'snapshot', revision: variant === 'conflict' ? 1 : 2,
                    conversationState: { ...idleControlState(), cwd: '/different-synthetic' } }
                : { type: 'patches', baseRevision: variant === 'gap' ? 9 : 1, revision: variant === 'gap' ? 10 : 2,
                    patches: [{ op: 'replace', path: ['turns', 0, 'status'], value: 'inProgress' },
                        { op: 'replace', path: ['threadRuntimeStatus', 'type'], value: 'active' }] };
            const event = variant === 'disconnect'
                ? { type: 'broadcast', method: 'client-status-changed', params: { status: 'disconnected', clientId: 'owner-synthetic' } }
                : { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
                    params: { hostId: 'local', conversationId: input.remoteSessionId, change } };
            socket.write(Buffer.concat([frame(ack), frame(event)]));
        };
        await startRouter();
        const result = getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId });
        if (variant === 'patch') await expect(result).resolves.toMatchObject({ state: 'running', textSendMode: 'steer' });
        else await expect(result).rejects.toThrow(variant === 'disconnect' ? 'owner_changed' : variant === 'gap' ? 'revision_gap' : 'invalid_snapshot');
        expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(1);
    });

    // 发现操作只能询问既有 owner，不能隐式打开或恢复会话。
    it('steers through the original owner and keeps turn-switch results unknown without retrying', async () => {
        const state = { id: input.remoteSessionId, cwd: '/synthetic', threadRuntimeStatus: { type: 'active' }, turns: [{ turnId: 'turn-1', status: 'inProgress', items: [] }], requests: [] };
        onFollow = (request, socket) => {
            if (request.params.following) respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
                sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: input.remoteSessionId,
                    change: { type: 'snapshot', revision: 1, conversationState: state } } });
        };
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'owner-synthetic', result: { result: { turnId: 'turn-2' } } });
        await startRouter();
        const action = { kind: 'steer' as const, machineId: 'machine-1', sessionId: 'linked-1', operationId: 'steer-1', expectedTurnId: 'turn-1', text: 'synthetic addition' };
        const target = { codexHome, remoteSessionId: input.remoteSessionId, accountId: input.accountId, action };
        expect(await performDesktopSessionControlAction(target)).toEqual({ status: 'unknown', reason: 'turn_changed' });
        expect(await performDesktopSessionControlAction(target)).toEqual({ status: 'unknown', reason: 'delivery_outcome_unknown' });
        expect(requests.filter((request) => request.method === 'thread-follower-steer-turn')).toHaveLength(1);
        expect(requests.find((request) => request.method === 'thread-follower-steer-turn')).toMatchObject({ version: 1,
            targetClientId: 'owner-synthetic', params: { conversationId: input.remoteSessionId, clientUserMessageId: 'steer-1',
                input: [{ type: 'text', text: 'synthetic addition', text_elements: [] }], restoreMessage: { id: 'steer-1', cwd: '/synthetic',
                    context: { prompt: 'synthetic addition', workspaceRoots: ['/synthetic'], addedFiles: [], fileAttachments: [], imageAttachments: [] } } } });
    });

    // 手机显示过的旧题必须在真正提交前重新绑定；非法或不完整答案不产生原生动作。
    it('拒绝换轮、题目修订、桌面已答和非法答案，同时允许完整多题原选项提交', async () => {
        const questions = [
            { id: 'first', header: '选择', question: '选一个', isOther: false, isSecret: false, options: [{ label: '甲', description: '原选项' }] },
            { id: 'second', header: '补充', question: '填写', isOther: false, isSecret: true, options: [] },
        ];
        const state = { id: input.remoteSessionId, cwd: '/synthetic', threadRuntimeStatus: { type: 'active' },
            requests: [{ id: '7', method: 'item/tool/requestUserInput', params: { threadId: input.remoteSessionId, turnId: 'turn-1', itemId: 'tool-1', questions } }],
            turns: [{ turnId: 'turn-1', status: 'inProgress', items: [] as unknown[] }] };
        onFollow = (request, socket) => { if (request.params.following) respond(socket, controlSnapshotFrame(state)); };
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'owner-synthetic', result: { ok: true } });
        await startRouter();
        expect(await getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId })).not.toHaveProperty('questions');
        expect(await getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId, includeQuestions: true }))
            .toMatchObject({ questions: [{ kind: 'user_input', requestId: '7', canAnswer: true }] });
        const projected = readDesktopControlSnapshot(state, input.remoteSessionId, true).questions![0]!;
        const action = { kind: 'answer' as const, requestKind: 'user_input' as const, machineId: 'machine-1', sessionId: 'linked-1',
            expectedTurnId: 'turn-1', operationId: 'multi-answer', requestId: '7', itemId: 'tool-1', revision: projected.revision,
            answers: { second: ['私密合成值'], first: ['甲'] } };
        const target = { codexHome, remoteSessionId: input.remoteSessionId, accountId: input.accountId };
        expect(await performDesktopSessionControlAction({ ...target, action: { ...action, expectedTurnId: 'old-turn' } })).toEqual({ status: 'rejected', reason: 'turn_changed' });
        expect(await performDesktopSessionControlAction({ ...target, action: { ...action, revision: 'old-revision' } })).toEqual({ status: 'rejected', reason: 'request_changed' });
        const invalidAnswers: Record<string, string[]>[] = [{ first: ['甲'] }, { first: ['自填不被允许'], second: ['私密合成值'] }, { first: ['甲'], second: [' '] },
            { first: ['甲', '乙'], second: ['私密合成值'] }, { first: ['甲'], second: ['私密合成值'], extra: ['多余'] }];
        for (const answers of invalidAnswers) {
            expect(await performDesktopSessionControlAction({ ...target, action: { ...action, answers } })).toEqual({ status: 'rejected', reason: 'invalid_answers' });
        }
        state.turns[0]!.items.push({ id: 'response', type: 'userInputResponse', requestId: '7', turnId: 'turn-1', completed: true,
            questions, answers: { first: ['甲'], second: ['桌面值'] } });
        expect(await performDesktopSessionControlAction({ ...target, action })).toEqual({ status: 'rejected', reason: 'request_expired' });
        expect(requests.filter((request) => request.method === 'thread-follower-submit-user-input')).toHaveLength(0);
        state.turns[0]!.items.pop();
        expect(await performDesktopSessionControlAction({ ...target, action })).toEqual({ status: 'unknown', reason: 'answer_outcome_unknown' });
        const delivered = requests.find((request) => request.method === 'thread-follower-submit-user-input')!;
        expect(delivered.params).toMatchObject({ requestId: '7', response: { answers: { first: { answers: ['甲'] }, second: { answers: ['私密合成值'] } } } });
        expect(Object.keys((delivered.params.response as { answers: Record<string, unknown> }).answers)).toEqual(['first', 'second']);
        const intents = await readdir(join(environment.activeServerDir, 'desktop-session-delivery'), { recursive: true });
        for (const path of intents.filter((path) => path.endsWith('.json')))
            expect(await readFile(join(environment.activeServerDir, 'desktop-session-delivery', path), 'utf8')).not.toContain('私密合成值');
    });

    // 原认证 lease 在意图写入后失效：没有发 IPC 时清理自己创建的意图，恢复后原题仍可提交。
    it('提交前目标失效不会留下未发送意图阻止同题重试', async () => {
        const state = { id: input.remoteSessionId, cwd: '/synthetic', threadRuntimeStatus: { type: 'active' },
            turns: [{ turnId: 'turn-1', status: 'inProgress', items: [] }], requests: [{ id: 7, method: 'item/tool/requestUserInput', params: {
                threadId: input.remoteSessionId, turnId: 'turn-1', itemId: 'tool-1', questions: [{ id: 'q', header: '', question: '输入', options: [] }] } }] };
        onFollow = (request, socket) => { if (request.params.following) respond(socket, controlSnapshotFrame(state)); };
        await startRouter();
        const ipc = await DesktopIpc.open(codexHome);
        await ipc.discoverOwner(input.remoteSessionId);
        await ipc.readControlSnapshot(input.remoteSessionId, () => {});
        const question = readDesktopControlSnapshot(state, input.remoteSessionId, true).questions![0]!;
        const action = { kind: 'answer' as const, requestKind: 'user_input' as const, machineId: 'machine', sessionId: 'linked',
            expectedTurnId: 'turn-1', operationId: 'retry-after-revocation', requestId: 7, itemId: 'tool-1', revision: question.revision, answers: { q: ['合成答案'] } };
        let revokeAfterIntent = true;
        const directory = join(environment.activeServerDir, 'desktop-session-delivery');
        const target = { codexHome, remoteSessionId: input.remoteSessionId, accountId: input.accountId, action,
            getFollowedIpc: () => {
                // 模拟机器认证生命周期的边界回调，内部 IPC、文件保护和题目逻辑全部执行真实实现。
                if (revokeAfterIntent && existsSync(directory) && readdirSync(directory, { recursive: true }).filter((name) => typeof name === 'string' && name.endsWith('.intent.json')).length === 2)
                    throw new DesktopIpcError('owner_changed');
                return ipc;
            } };
        try {
            expect(await performDesktopSessionControlAction(target)).toEqual({ status: 'rejected', reason: 'owner_changed' });
            expect(requests.filter((request) => request.method === 'thread-follower-submit-user-input')).toHaveLength(0);
            revokeAfterIntent = false;
            expect(await performDesktopSessionControlAction(target)).toEqual({ status: 'unknown', reason: 'answer_outcome_unknown' });
            expect(requests.filter((request) => request.method === 'thread-follower-submit-user-input')).toHaveLength(1);
            expect(await performDesktopSessionControlAction(target)).toEqual({ status: 'unknown', reason: 'answer_outcome_unknown' });
            expect(requests.filter((request) => request.method === 'thread-follower-submit-user-input')).toHaveLength(1);
        } finally { ipc.close(); }
    });

    // 原计划动作只认同类型 ID 与原题修订；ACK 后必须核对同轮答案项，且不会重投未知动作。
    it.each(['recorded', 'ack-only'] as const)('计划回答保持数字请求身份，并将 %s 与执行接受分开', async (outcome) => {
        const question = { id: 'q-1', header: '方案', question: '选择方案', isOther: true, isSecret: false,
            options: [{ label: '甲', description: '说明' }] };
        const state = { id: input.remoteSessionId, cwd: '/synthetic', threadRuntimeStatus: { type: 'active' },
            turns: [{ turnId: 'turn-1', status: 'inProgress', items: [] }], requests: [{ id: 7, method: 'item/tool/requestUserInput',
                params: { threadId: input.remoteSessionId, turnId: 'turn-1', itemId: 'tool-1', questions: [question] } }] };
        onFollow = (request, socket) => { if (request.params.following) respond(socket, controlSnapshotFrame(state)); };
        onAction = (request, socket) => {
            if (outcome === 'recorded') respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
                sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: input.remoteSessionId,
                    change: { type: 'snapshot', revision: 2, conversationState: { ...state, requests: [], turns: [{ ...state.turns[0], items: [
                        { type: 'userInputResponse', id: 'user-input-response-7', requestId: 7, turnId: 'turn-1', completed: true,
                            questions: [question], answers: { 'q-1': ['自填内容'] } },
                    ] }] } } } });
            respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
                resultType: 'success', handledByClientId: 'owner-synthetic', result: { ok: true } });
        };
        await startRouter();
        const projected = readDesktopControlSnapshot(state, input.remoteSessionId, true).questions![0]!;
        const action = { kind: 'answer' as const, requestKind: 'user_input' as const, machineId: 'machine-1', sessionId: 'linked-1',
            expectedTurnId: 'turn-1', operationId: 'answer-1', requestId: 7, itemId: 'tool-1', revision: projected.revision,
            answers: { 'q-1': ['自填内容'] } };
        const target = { codexHome, remoteSessionId: input.remoteSessionId, accountId: input.accountId };
        expect(await performDesktopSessionControlAction({ ...target, action: { ...action, requestId: '7' } }))
            .toEqual({ status: 'rejected', reason: 'request_expired' });
        expect(await performDesktopSessionControlAction({ ...target, action })).toEqual(outcome === 'recorded'
            ? { status: 'recorded', turnId: 'turn-1' } : { status: 'unknown', reason: 'answer_outcome_unknown' });
        expect(await performDesktopSessionControlAction({ ...target, action })).toEqual({ status: 'unknown', reason: 'answer_outcome_unknown' });
        const deliveries = requests.filter((request) => request.method === 'thread-follower-submit-user-input');
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]).toMatchObject({ version: 1, targetClientId: 'owner-synthetic', params: {
            conversationId: input.remoteSessionId, requestId: 7, response: { answers: { 'q-1': { answers: ['自填内容'] } } },
        } });
    });

    // Q04 的多题封套沿同一 steer 原轮次投递，只有匹配本次操作和目标轮的 accepted 项可确认。
    it.each(['accepted', 'pending', 'wrong-turn', 'wrong-operation', 'wrong-answer', 'partial'] as const)('异步多题一次投递并核对 %s 回读', async (outcome) => {
        const card = { type: 'agentMessage', id: 'card-1', questions: [{ title: '选择', options: ['甲', '乙'] }, { title: '补充', options: [] }] };
        const state = { id: input.remoteSessionId, cwd: '/synthetic', threadRuntimeStatus: { type: 'active' },
            turns: [{ turnId: 'turn-1', status: 'inProgress', items: [card] as unknown[] }], requests: [] };
        if (outcome === 'partial') state.turns[0]!.items.push({ type: 'steeringUserMessage', id: 'desktop-first', targetTurnId: 'turn-1', status: 'accepted',
            input: [{ type: 'text', text: `<send_user_message_question_reply>${JSON.stringify([{ questionItemId: JSON.stringify(['request_user_input_async', 'card-1', 0]), question: '选择', answer: '乙' }])}</send_user_message_question_reply>` }] });
        onFollow = (request, socket) => { if (request.params.following) respond(socket, controlSnapshotFrame(state)); };
        onAction = (request, socket) => {
            respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
                params: { hostId: 'local', conversationId: input.remoteSessionId, change: { type: 'snapshot', revision: 2,
                    conversationState: { ...state, turns: [{ ...state.turns[0], items: [card, { type: 'steeringUserMessage',
                        id: outcome === 'wrong-operation' ? 'other-operation' : request.params.clientUserMessageId,
                        clientUserMessageId: outcome === 'wrong-operation' ? 'other-operation' : request.params.clientUserMessageId,
                        status: outcome === 'pending' ? 'pending' : 'accepted', targetTurnId: outcome === 'wrong-turn' ? 'turn-2' : 'turn-1',
                        input: outcome === 'wrong-answer' ? [{ type: 'text', text: '普通文字不能代答' }] : request.params.input }] }] } } } });
            respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
                resultType: 'success', handledByClientId: 'owner-synthetic', result: { result: { turnId: 'turn-1' } } });
        };
        await startRouter();
        const projected = readDesktopControlSnapshot(state, input.remoteSessionId, true).questions![0]!;
        const answers = Object.fromEntries(projected.questions.map((question, index) => [question.id, [index ? '补充文字' : '乙']]));
        const action = { kind: 'answer' as const, requestKind: 'async_questions' as const, machineId: 'machine-1', sessionId: 'linked-1',
            expectedTurnId: 'turn-1', operationId: 'async-answer-1', requestId: null, itemId: 'card-1', revision: projected.revision, answers };
        const target = { codexHome, remoteSessionId: input.remoteSessionId, accountId: input.accountId, action };
        expect(await performDesktopSessionControlAction(target)).toEqual((outcome === 'accepted' || outcome === 'partial')
            ? { status: 'accepted', turnId: 'turn-1' } : { status: 'unknown', reason: 'answer_outcome_unknown' });
        expect(await performDesktopSessionControlAction(target)).toEqual({ status: 'unknown', reason: 'answer_outcome_unknown' });
        const deliveries = requests.filter((request) => request.method === 'thread-follower-steer-turn');
        expect(deliveries).toHaveLength(1);
        const text = `<send_user_message_question_reply>\n${JSON.stringify(projected.questions.filter((question) => !projected.answers?.[question.id]).map((question) => ({
            questionItemId: question.id, question: question.question, answer: answers[question.id]![0],
        })))}\n</send_user_message_question_reply>`;
        expect(deliveries[0]).toMatchObject({ params: { input: [{ type: 'text', text, text_elements: [] }], attachments: [],
            restoreMessage: { context: { turnTrigger: 'send_user_message_async_question' } } } });
        expect(requests.some((request) => request.method === 'thread-follower-start-turn')).toBe(false);
    });

    it('binds approvals to exact current requests and never treats an ACK as decision success', async () => {
        const state = { id: input.remoteSessionId, threadRuntimeStatus: { type: 'active' }, turns: [{ turnId: 'turn-1', status: 'inProgress', items: [] }],
            requests: [{ id: 7, method: 'item/commandExecution/requestApproval', params: {
                threadId: input.remoteSessionId, turnId: 'turn-1', command: 'echo synthetic', cwd: '/synthetic' } }] };
        onFollow = (request, socket) => {
            if (request.params.following) respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
                sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: input.remoteSessionId,
                    change: { type: 'snapshot', revision: 1, conversationState: state } } });
        };
        await startRouter();
        const action = { kind: 'approval' as const, machineId: 'machine-1', sessionId: 'linked-1', operationId: 'op-1',
            expectedTurnId: 'turn-1', requestId: '7', revision: readDesktopControlSnapshot(state, input.remoteSessionId).requests[0]!.revision,
            decision: 'allow_once' as const };
        const target = { codexHome, remoteSessionId: input.remoteSessionId, accountId: input.accountId };
        expect(await performDesktopSessionControlAction({ ...target, action })).toMatchObject({ status: 'unknown', reason: 'approval_outcome_unknown' });
        expect(requests.find((request) => request.method === 'thread-follower-command-approval-decision')).toMatchObject({
            targetClientId: 'owner-synthetic', version: 1, params: { conversationId: input.remoteSessionId, requestId: 7, decision: 'accept' } });
        expect(await performDesktopSessionControlAction({ ...target, action: { ...action, operationId: 'op-2', decision: 'deny' } }))
            .toMatchObject({ status: 'rejected', reason: 'request_decision_conflict' });
        expect(requests.filter((request) => request.method === 'thread-follower-command-approval-decision')).toHaveLength(1);
        expect(await performDesktopSessionControlAction({ ...target, action: { ...action, requestId: '8', operationId: 'expired' } }))
            .toMatchObject({ status: 'rejected', reason: 'request_expired' });
        state.requests[0]!.id = 8;
        state.requests[0]!.params.command = 'echo changed';
        expect(await performDesktopSessionControlAction({ ...target, action: { ...action, requestId: '8', operationId: 'changed' } }))
            .toMatchObject({ status: 'rejected', reason: 'request_changed' });
        expect(await performDesktopSessionControlAction({ ...target, action: { ...action, requestId: '8',
            revision: readDesktopControlSnapshot(state, input.remoteSessionId).requests[0]!.revision } }))
            .toMatchObject({ status: 'rejected', reason: 'local_id_conflict' });
        state.turns[0]!.turnId = 'turn-2';
        expect(await performDesktopSessionControlAction({ ...target, action: { ...action, requestId: '8', operationId: 'op-3' } }))
            .toMatchObject({ status: 'rejected', reason: 'turn_changed' });
    });

    // 四种实际决定穿过真实 IPC 与持久化去重；只在外部桌面边界使用合成请求。
    it.each([
        ['command', 'allow_once', 'accept'], ['command', 'deny', 'decline'],
        ['file', 'allow_once', 'accept'], ['file', 'deny', 'decline'],
    ] as const)('dispatches %s %s once to the original owner', async (kind, decision, nativeDecision) => {
        const state = { id: input.remoteSessionId, threadRuntimeStatus: { type: 'active' },
            turns: [{ turnId: 'turn-1', status: 'inProgress', items: kind === 'file'
                ? [{ id: 'file-1', type: 'fileChange', changes: [{ path: '/synthetic/sample.txt', kind: { type: 'update' }, diff: '-old\n+new' }] }] : [] }],
            requests: [{ id: 91, method: kind === 'file' ? 'item/fileChange/requestApproval' : 'item/commandExecution/requestApproval',
                params: { threadId: input.remoteSessionId, turnId: 'turn-1', itemId: 'file-1', cwd: '/synthetic', command: 'echo synthetic' } }] };
        onFollow = (request, socket) => {
            if (request.params.following) respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
                sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: input.remoteSessionId,
                    change: { type: 'snapshot', revision: 1, conversationState: state } } });
        };
        await startRouter();
        const approval = readDesktopControlSnapshot(state, input.remoteSessionId).requests[0]!;
        expect(approval.canDecide).toBe(true);
        const action = { kind: 'approval' as const, machineId: 'machine-1', sessionId: 'linked-1', operationId: 'decision-1',
            expectedTurnId: 'turn-1', requestId: '91', revision: approval.revision, decision };
        const target = { codexHome, remoteSessionId: input.remoteSessionId, accountId: input.accountId, action };
        expect(await performDesktopSessionControlAction(target)).toMatchObject({ status: 'unknown' });
        // 同按钮再次触发不能把决定重复发送给桌面。
        expect(await performDesktopSessionControlAction(target)).toMatchObject({ status: 'unknown' });
        const sent = requests.filter((request) => request.method === `thread-follower-${kind}-approval-decision`);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ targetClientId: 'owner-synthetic', version: 1,
            params: { conversationId: input.remoteSessionId, requestId: 91, decision: nativeDecision } });
    });

    it('discovers the current owner without opening or resuming a thread', async () => {
        await startRouter();
        expect(await getDesktopSessionControl({ codexHome, remoteSessionId: input.remoteSessionId }))
            .toEqual({ available: true, ownerClientId: 'owner-synthetic', protocolVersion: 2 });
        expect(requests.map((request) => request.method)).toEqual(['initialize', 'thread-owner-discovery']);
        expect(requests[1]).toMatchObject({ version: 1, params: { hostId: 'local', conversationId: input.remoteSessionId } });
    });

    it('observes explicit Desktop state, bound requests and continuous patches through the real socket', async () => {
        await startRouter();
        const ipc = await DesktopIpc.open(codexHome);
        await ipc.discoverOwner(input.remoteSessionId);
        const observations: unknown[] = [];
        let ownerSocket: Socket;
        const sendChange = (change: unknown, version = 11, sourceClientId = 'owner-synthetic') => respond(ownerSocket, {
            type: 'broadcast', method: 'thread-stream-state-changed', version, sourceClientId,
            params: { hostId: 'local', conversationId: input.remoteSessionId, change },
        });
        onFollow = (request, socket) => {
            ownerSocket = socket;
            if (request.params.following) sendChange({ type: 'snapshot', revision: 1, conversationState: {
                id: input.remoteSessionId, turns: [{ turnId: 'turn-1', status: 'inProgress', items: [] }], requests: [],
            } });
        };
        ipc.followConversation(input.remoteSessionId, (observation) => observations.push(observation));
        await vi.waitFor(() => expect(observations).toHaveLength(2));
        expect(observations.at(-1)).toMatchObject({ state: 'unknown' });
        sendChange({ type: 'patches', baseRevision: 1, revision: 2, patches: [
            { op: 'add', path: ['requests', 0], value: { id: 42, method: 'item/tool/requestUserInput',
                params: { threadId: input.remoteSessionId, turnId: 'turn-1' } } },
        ] });
        await vi.waitFor(() => expect(observations.at(-1)).toMatchObject({ state: 'needs_input', turnId: 'turn-1',
            requests: [{ requestId: '42', kind: 'user_action_request' }] }));
        sendChange({ type: 'patches', baseRevision: 2, revision: 3, patches: [
            { op: 'replace', path: ['turns', 0, 'status'], value: 'completed' },
            { op: 'replace', path: ['requests'], value: [] },
        ] });
        await vi.waitFor(() => expect(observations.at(-1)).toMatchObject({ state: 'completed', turnId: 'turn-1' }));
        sendChange({ type: 'patches', baseRevision: 3, revision: 4, patches: [
            { op: 'add', path: ['threadRuntimeStatus'], value: { type: 'active' } },
        ] });
        await vi.waitFor(() => expect(observations.at(-1)).toMatchObject({ state: 'unknown' }));
        ipc.close();
        expect(observations.at(-1)).toEqual({ v: 1, state: 'unknown', reason: 'connection_closed' });
        expect(requests.some((request) => request.method === 'thread-follower-start-turn')).toBe(false);
    });

    it('keeps the first canonical snapshot unconfirmed and accepts only an ordered current turn', async () => {
        await startRouter();
        const ipc = await DesktopIpc.open(codexHome);
        await ipc.discoverOwner(input.remoteSessionId);
        const observations: Array<{ state: string; turnId?: string }> = [];
        const next = { v: 1 as const, source: 'desktop' as const, state: 'running' as const, turnId: 'current' };
        const callbackProofs: boolean[] = [];
        let ownerSocket!: Socket;
        const snapshot = (revision: number, turns: Array<{ turnId: string; status: string }>, newerBoundary = 'exhausted') => respond(ownerSocket, {
            type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
            params: { hostId: 'local', conversationId: input.remoteSessionId, change: { type: 'snapshot', revision, conversationState: {
                id: input.remoteSessionId, requests: [], turns: [], historyMode: 'paginated', canonicalVoiceHistory: true,
                threadRuntimeStatus: { type: 'idle' }, paginatedHistory: { itemsBackwardsCursor: 'synthetic' },
                turnHistory: { kind: 'canonical', history: { generation: 0, isComplete: true,
                    entitiesByKey: Object.fromEntries(turns.map((turn) => [turn.turnId, { ...turn, items: [] }])),
                    islands: [{ id: 'tail:0', entries: turns.map((turn) => ({ key: turn.turnId, value: turn.turnId })),
                        olderBoundary: { status: 'exhausted' }, newerBoundary: { status: newerBoundary } }],
                } },
            } } },
        });
        onFollow = (request, socket) => {
            ownerSocket = socket;
            if (request.params.following) snapshot(258, [{ turnId: 'old', status: 'completed' }]);
        };
        ipc.followConversation(input.remoteSessionId, (value) => {
            observations.push(value);
            callbackProofs.push(ipc.confirmsFollowingTurn(input.remoteSessionId, 'old', next));
        });
        await vi.waitFor(() => expect(observations).toHaveLength(2));
        expect(observations.at(-1)).toMatchObject({ state: 'unknown' });
        expect(ipc.confirmsFollowingTurn(input.remoteSessionId, 'old', next)).toBe(false);
        snapshot(259, [{ turnId: 'old', status: 'completed' }]);
        await vi.waitFor(() => expect(observations).toHaveLength(3));
        expect(observations.at(-1)).toMatchObject({ state: 'unknown' });
        // 更高 revision 本身不证明新轮；没有相对基线的顺序时仍须未知。
        snapshot(260, [{ turnId: 'unrelated', status: 'inProgress' }]);
        await vi.waitFor(() => expect(observations).toHaveLength(4));
        expect(observations.at(-1)).toMatchObject({ state: 'unknown' });
        // A 已不在加载范围时，B 的后续明确生命周期补丁应恢复，不能永远等待 A 回来。
        respond(ownerSocket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
            sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: input.remoteSessionId,
                change: { type: 'patches', baseRevision: 260, revision: 261, patches: [
                    { op: 'replace', path: ['turnHistory', 'history', 'entitiesByKey', 'unrelated', 'status'], value: 'completed' },
                ] } } });
        await vi.waitFor(() => expect(observations.at(-1)).toMatchObject({ state: 'completed', turnId: 'unrelated' }));
        expect(ipc.confirmsFollowingTurn(input.remoteSessionId, 'old', { ...next, state: 'completed', turnId: 'unrelated' })).toBe(false);
        snapshot(294, [{ turnId: 'old', status: 'completed' }, { turnId: 'unrelated', status: 'completed' }, { turnId: 'current', status: 'inProgress' }]);
        await vi.waitFor(() => expect(observations.at(-1)).toMatchObject({ state: 'running', turnId: 'current' }));
        expect(callbackProofs.at(-1)).toBe(true);
        expect(ipc.confirmsFollowingTurn(input.remoteSessionId, 'old', next)).toBe(true);
        expect(ipc.confirmsFollowingTurn('different-thread', 'old', next)).toBe(false);
        expect(ipc.confirmsFollowingTurn(input.remoteSessionId, 'missing-tail-turn', next)).toBe(false);
        expect(ipc.confirmsFollowingTurn(input.remoteSessionId, 'current', next)).toBe(false);
        expect(ipc.confirmsFollowingTurn(input.remoteSessionId, 'old', { ...next, state: 'completed' })).toBe(false);
        // 不完整尾岛不能延续独立基线的当前状态证明。
        snapshot(295, [{ turnId: 'old', status: 'completed' }, { turnId: 'current', status: 'inProgress' }], 'unknown');
        await vi.waitFor(() => expect(observations).toHaveLength(7));
        expect(ipc.confirmsFollowingTurn(input.remoteSessionId, 'old', next)).toBe(false);
        snapshot(296, [{ turnId: 'old', status: 'completed' }]);
        await vi.waitFor(() => expect(observations).toHaveLength(8));
        expect(observations.at(-1)).toMatchObject({ state: 'unknown' });
        snapshot(297, [{ turnId: 'old', status: 'completed' }, { turnId: 'current', status: 'completed' }]);
        await vi.waitFor(() => expect(observations.at(-1)).toMatchObject({ state: 'completed', turnId: 'current' }));
        const completed = { ...next, state: 'completed' as const };
        expect(ipc.confirmsFollowingTurn(input.remoteSessionId, 'old', completed)).toBe(true);
        ipc.close();
        expect(ipc.confirmsFollowingTurn(input.remoteSessionId, 'old', completed)).toBe(false);
        expect(requests.some((request) => request.method === 'thread-follower-load-complete-history')).toBe(false);
    });

    it.each(['inProgress', 'completed'] as const)('confirms an explicit %s turn insertion after an empty baseline without requiring a placeholder id patch', async (status) => {
        await startRouter();
        const ipc = await DesktopIpc.open(codexHome);
        await ipc.discoverOwner(input.remoteSessionId);
        const observations: Array<{ state: string; turnId?: string }> = [];
        const continuities: string[] = [];
        let ownerSocket!: Socket;
        const change = (value: unknown) => respond(ownerSocket, {
            type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
            params: { hostId: 'local', conversationId: input.remoteSessionId, change: value },
        });
        onFollow = (request, socket) => {
            ownerSocket = socket;
            if (request.params.following) change({ type: 'snapshot', revision: 1,
                conversationState: { id: input.remoteSessionId, requests: [], turns: [] } });
        };
        ipc.followConversation(input.remoteSessionId, (value, continuity) => { observations.push(value); continuities.push(continuity); });
        await vi.waitFor(() => expect(observations).toHaveLength(2));
        change({ type: 'patches', baseRevision: 1, revision: 2, patches: [
            { op: 'add', path: ['turns', 0], value: { turnId: 'first', status, items: [] } },
        ] });
        await vi.waitFor(() => expect(observations.at(-1)).toMatchObject({ state: status === 'inProgress' ? 'running' : 'completed', turnId: 'first' }));
        expect(continuities.at(-1)).toBe('event');
        ipc.close();
    });

    it.each(['wrong_owner', 'wrong_version', 'revision_gap', 'missing_turn_id', 'text_only', 'unsupported_request'])('keeps %s Desktop evidence unknown', async (variant) => {
        await startRouter();
        const ipc = await DesktopIpc.open(codexHome);
        await ipc.discoverOwner(input.remoteSessionId);
        const observations: Array<{ state: string }> = [];
        let ownerSocket!: Socket;
        onFollow = (request, socket) => { ownerSocket = socket; respond(socket, {
            type: 'broadcast', method: 'thread-stream-state-changed', version: variant === 'wrong_version' ? 10 : 11,
            sourceClientId: variant === 'wrong_owner' ? 'other-owner' : 'owner-synthetic',
            params: { hostId: 'local', conversationId: input.remoteSessionId, change: variant === 'revision_gap'
                ? { type: 'patches', baseRevision: 99, revision: 100, patches: [] }
                : { type: 'snapshot', revision: 1, conversationState: {
                    id: input.remoteSessionId, requests: variant === 'unsupported_request'
                        ? [{ id: 1, method: 'unsupported', params: { threadId: input.remoteSessionId, turnId: 'turn-1' } }] : [], turns: [{
                        ...(variant === 'missing_turn_id' ? {} : { turnId: 'turn-1' }),
                        ...(variant === 'text_only' ? {} : { status: variant === 'unsupported_request' ? 'inProgress' : 'completed' }),
                        items: [{ type: 'agentMessage', text: 'I am done' }],
                    }],
                } } },
        }); };
        ipc.followConversation(input.remoteSessionId, (observation) => observations.push(observation));
        await vi.waitFor(() => expect(observations.length).toBeGreaterThan(1));
        expect(observations.every((observation) => observation.state === 'unknown')).toBe(true);
        if (variant === 'unsupported_request') {
            const sendPatches = (baseRevision: number, patches: unknown[]) => respond(ownerSocket, {
                type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
                params: { hostId: 'local', conversationId: input.remoteSessionId,
                    change: { type: 'patches', baseRevision, revision: baseRevision + 1, patches } },
            });
            sendPatches(1, [{ op: 'replace', path: ['requests'], value: [] }]);
            await vi.waitFor(() => expect(observations).toHaveLength(3));
            expect(observations.at(-1)).toMatchObject({ state: 'unknown' });
            sendPatches(2, [{ op: 'replace', path: ['turns', 0, 'status'], value: 'completed' }]);
            await vi.waitFor(() => expect(observations.at(-1)).toMatchObject({ state: 'completed', turnId: 'turn-1' }));
        }
        ipc.close();
    });

    it.each(['active', 'inactive'] as const)('delivers verified image/file inputs once on native %s, retaining the local echo identity', async (mode) => {
        const dir = join(root, 'happier/uploads/scope/messages', input.localId);
        await mkdir(dir, { recursive: true });
        const attachments = ([['image', 'image.png', 'png!'], ['file', 'note.txt', 'note']] as const).map(([kind, name, bytes]) => ({
            name, path: join(dir, name), kind, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        }));
        await writeFile(attachments[0]!.path, 'png!'); await writeFile(attachments[1]!.path, 'note');
        onAction = (request, socket) => respond(socket, mode === 'active'
            ? { type: 'response', requestId: request.requestId, method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic', result: { result: { turnId: 'native-current-turn' } } }
            : { type: 'response', requestId: request.requestId, resultType: 'error', error: `Cannot steer conversation ${input.remoteSessionId} because its active turn already ended` });
        await startRouter();
        const message = { codexHome, ...input, text: '', textSendProtocol: 'native-auto-v1' as const, attachments, attachmentWorkingDirectory: root };
        expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'accepted' });
        const native = requests.find((request) => request.method === 'thread-follower-steer-turn')!;
        expect(native.params).toMatchObject({ clientUserMessageId: input.localId, attachments: expect.arrayContaining([
            { label: 'note.txt', path: attachments[1]!.path, fsPath: attachments[1]!.path },
            { label: 'image.png', path: attachments[0]!.path, fsPath: attachments[0]!.path, isImageAttachment: true },
        ]), input: [expect.objectContaining({ type: 'text', text: expect.stringContaining('Files mentioned by the user') }), { type: 'localImage', path: attachments[0]!.path }],
            restoreMessage: { id: input.localId, cwd: root, text: '', context: { prompt: '', imageAttachments: [expect.objectContaining({ localPath: attachments[0]!.path })] } } });
        if (mode === 'inactive') expect(requests.find((request) => request.method === 'thread-follower-start-turn')?.params).toMatchObject({ turnStart: {
            request: { clientUserMessageId: input.localId, input: native.params.input }, context: { localTurnMetadata: { fileAttachmentCount: 1 }, attachments: native.params.attachments },
        } });
        expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'accepted', deduplicated: true });
        expect(await sendDesktopSessionUserMessage({ ...message, attachments: attachments.slice(0, 1) })).toMatchObject({ status: 'rejected', reason: 'local_id_conflict' });
        expect(requests.filter((request) => request.method === 'thread-follower-steer-turn')).toHaveLength(1);
    });

    it('delivers opted-in ordinary text to the native active turn without waiting for history', async () => {
        onHistory = () => {};
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic',
            result: { result: { turnId: 'native-current-turn' } } });
        await startRouter();
        const message = { codexHome, ...input, textSendProtocol: 'native-auto-v1' as const };
        const result = sendDesktopSessionUserMessage(message);
        try {
            await vi.waitFor(() => expect(requests.some((request) => request.method === 'thread-follower-steer-turn')).toBe(true), { timeout: 1000 });
            const acceptedResult = await result;
            expect(acceptedResult).toMatchObject({ status: 'accepted', turnId: 'native-current-turn', receiptPersisted: true });
            expect(await sendDesktopSessionUserMessage(message)).toEqual({ ...acceptedResult, deduplicated: true });
            expect(requests.map((request) => request.method)).toEqual(['initialize', 'thread-owner-discovery', 'thread-follower-steer-turn']);
            expect(requests.at(-1)).toMatchObject({ version: 1, targetClientId: 'owner-synthetic', params: {
                conversationId: input.remoteSessionId, clientUserMessageId: input.localId,
                input: [{ type: 'text', text: input.text, text_elements: [] }], attachments: [],
                restoreMessage: { id: input.localId, text: input.text, context: { prompt: input.text,
                    addedFiles: [], fileAttachments: [], ideContext: null, imageAttachments: [] } },
            } });
            expect(requests.at(-1)?.params.restoreMessage).not.toHaveProperty('cwd');
            expect(execFile).not.toHaveBeenCalled();
        } finally {
            for (const socket of sockets) socket.destroy();
            await result;
        }
    });

    it.each(['timeout', 'owner_unavailable'] as const)('opens the same existing task once after undispatched cold native discovery %s', async (reason) => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        const loaded = onDiscover;
        let opened = false;
        // timeout 保留真实五秒无回应；官方入口之后仍经原 socket 协议发现 owner。
        onDiscover = (request, socket) => {
            if (opened) loaded(request, socket);
            else if (reason === 'owner_unavailable') missingOwner(request, socket);
        };
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            opened = true;
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic',
            result: { result: { turnId: 'native-current-turn' } } });
        await startRouter();
        const message = { codexHome, ...input, remoteSessionId: openId, textSendProtocol: 'native-auto-v1' as const };
        const result = await sendDesktopSessionUserMessage(message);
        expect(result).toMatchObject({ status: 'accepted', localId: input.localId, remoteSessionId: openId,
            turnId: 'native-current-turn', deduplicated: false, receiptPersisted: true });
        expect(await sendDesktopSessionUserMessage(message)).toEqual({ ...result, deduplicated: true });
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(execFile).toHaveBeenCalledWith('/usr/bin/open', ['-b', 'com.openai.codex', `codex://threads/${openId}?hostId=local`],
            expect.objectContaining({ timeout: 2_000 }), expect.any(Function));
        const discoveries = requests.filter((request) => request.method === 'thread-owner-discovery');
        expect(discoveries).toHaveLength(2);
        expect(requests.filter((request) => request.method === 'initialize')).toHaveLength(1);
        expect(discoveries.every((request) => request.params.conversationId === openId)).toBe(true);
        const deliveries = requests.filter((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method));
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]).toMatchObject({ method: 'thread-follower-steer-turn', timeoutMs: 5_000, targetClientId: 'owner-synthetic', params: {
            conversationId: openId, clientUserMessageId: input.localId,
            input: [{ type: 'text', text: input.text, text_elements: [] }], attachments: [],
        } });
        expect(requests.some((request) => request.method === 'thread-follower-load-complete-history')).toBe(false);
    });

    it('does not launch after the initial cold failure revokes the caller identity', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        let revoked = false;
        onDiscover = (request, socket) => { revoked = true; missingOwner(request, socket); };
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input, remoteSessionId: openId,
            textSendProtocol: 'native-auto-v1', getFollowedIpc: () => {
                if (revoked) throw new DesktopIpcError('owner_changed');
                return null;
            } })).toMatchObject({ status: 'rejected', reason: 'owner_changed' });
        expect(execFile).not.toHaveBeenCalled();
        expect(requests.some((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toBe(false);
    });

    it.each(['initialization', 'launch', 'final-discovery'] as const)('rejects undispatched recovery when %s reaches the ten-second monotonic budget', async (stage) => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        const loaded = onDiscover;
        let opened = false;
        let now = 0;
        const initialized = onInitialize;
        onInitialize = (request, socket) => {
            if (stage === 'initialization') now = 10_000;
            initialized(request, socket);
        };
        onDiscover = (request, socket) => {
            if (!opened) missingOwner(request, socket);
            else {
                if (stage === 'final-discovery') now = 10_000;
                loaded(request, socket);
            }
        };
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            opened = true;
            if (stage === 'launch') now = 10_000;
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic',
            result: { result: { turnId: 'native-current-turn' } } });
        await startRouter();
        // 单调时钟属于系统边界；推进时间无需让真实测试等待十秒。
        const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
        try {
            expect(await sendDesktopSessionUserMessage({ codexHome, ...input, remoteSessionId: openId, textSendProtocol: 'native-auto-v1' }))
                .toMatchObject({ status: 'rejected', reason: 'timeout', deduplicated: false });
            expect(execFile).toHaveBeenCalledTimes(1);
            expect(requests.some((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toBe(false);
            const files = await readdir(join(environment.activeServerDir, 'desktop-session-delivery'), { recursive: true });
            expect(files.filter((name) => name.endsWith('.json'))).toEqual([]);
        } finally { clock.mockRestore(); }
    });

    it('releases the recovered intent only after an exact inactive rejection exhausts the action budget before start', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        const loaded = onDiscover;
        let opened = false;
        let now = 0;
        onDiscover = (request, socket) => opened ? loaded(request, socket) : missingOwner(request, socket);
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            opened = true;
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        onAction = (request, socket) => {
            now = 15_000;
            respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
                resultType: 'error', handledByClientId: 'owner-synthetic',
                error: `Cannot steer conversation ${openId} because its active turn already ended` });
        };
        await startRouter();
        const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
        try {
            const message = { codexHome, ...input, remoteSessionId: openId, textSendProtocol: 'native-auto-v1' as const };
            expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'rejected', reason: 'timeout', deduplicated: false });
            expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(0);
            const files = await readdir(join(environment.activeServerDir, 'desktop-session-delivery'), { recursive: true });
            expect(files.filter((name) => name.endsWith('.json'))).toEqual([]);
            // 再次明确提交仍使用原 localId；已有 owner 的原快路径不套用恢复预算。
            now = 0;
            expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'accepted', localId: input.localId, deduplicated: false });
            expect(execFile).toHaveBeenCalledTimes(1);
            expect(requests.filter((request) => request.method === 'thread-follower-steer-turn')).toHaveLength(2);
            expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(1);
        } finally { clock.mockRestore(); }
    });

    it('caps the recovered start response to the remaining action budget and retains its unknown intent', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        const loaded = onDiscover;
        let opened = false;
        let now = 0;
        onDiscover = (request, socket) => opened ? loaded(request, socket) : missingOwner(request, socket);
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            opened = true;
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        onAction = (request, socket) => {
            now = 14_975;
            respond(socket, { type: 'response', requestId: request.requestId, resultType: 'error',
                error: `Cannot steer conversation ${openId} because its active turn already ended` });
        };
        // 原 start 已发但无应答，真实请求 timer 必须按剩余 25 毫秒收敛为 unknown。
        onStart = () => {};
        await startRouter();
        const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
        try {
            const message = { codexHome, ...input, remoteSessionId: openId, textSendProtocol: 'native-auto-v1' as const };
            const first = await sendDesktopSessionUserMessage(message);
            expect(first).toMatchObject({ status: 'unknown', reason: 'timeout' });
            expect(requests.find((request) => request.method === 'thread-follower-steer-turn')?.timeoutMs).toBe(5_000);
            expect(requests.find((request) => request.method === 'thread-follower-start-turn')?.timeoutMs).toBe(25);
            expect(await sendDesktopSessionUserMessage(message)).toEqual({ ...first, deduplicated: true });
            expect(execFile).toHaveBeenCalledTimes(1);
            expect(requests.filter((request) => request.method === 'thread-follower-steer-turn')).toHaveLength(1);
            expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(1);
        } finally { clock.mockRestore(); }
    });

    it.each(['inactive', 'start-ack'] as const)('keeps the recovered two-action identity boundary when revoked at %s', async (stage) => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        const loaded = onDiscover;
        let opened = false;
        let revoked = false;
        onDiscover = (request, socket) => opened ? loaded(request, socket) : missingOwner(request, socket);
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            opened = true;
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        onAction = (request, socket) => {
            revoked = stage === 'inactive';
            respond(socket, { type: 'response', requestId: request.requestId, resultType: 'error',
                error: `Cannot steer conversation ${openId} because its active turn already ended` });
        };
        onStart = (request, socket) => { revoked = true; accepted(request, socket); };
        await startRouter();
        const message = { codexHome, ...input, remoteSessionId: openId, textSendProtocol: 'native-auto-v1' as const,
            getFollowedIpc: () => {
                if (revoked) throw new DesktopIpcError('owner_changed');
                return null;
            } };
        const first = await sendDesktopSessionUserMessage(message);
        expect(first).toMatchObject({ status: 'unknown', reason: 'owner_changed' });
        expect(await sendDesktopSessionUserMessage(message)).toEqual({ ...first, deduplicated: true });
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(requests.filter((request) => request.method === 'thread-follower-steer-turn')).toHaveLength(1);
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(stage === 'inactive' ? 0 : 1);
    });

    it.each(['launch', 'discovery'] as const)('rejects undispatched native text when identity is revoked during the official task open (%s)', async (stage) => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        const loaded = onDiscover;
        let revoked = false;
        let opened = false;
        onDiscover = (request, socket) => {
            if (!opened) missingOwner(request, socket);
            else {
                revoked = true;
                loaded(request, socket);
            }
        };
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            opened = true;
            revoked = stage === 'launch';
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        await startRouter();
        const result = await sendDesktopSessionUserMessage({ codexHome, ...input, remoteSessionId: openId,
            textSendProtocol: 'native-auto-v1', getFollowedIpc: () => {
                if (revoked) throw new DesktopIpcError('owner_changed');
                return null;
            } });
        expect(result).toMatchObject({ status: 'rejected', reason: 'owner_changed', localId: input.localId });
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(stage === 'launch' ? 1 : 2);
        expect(requests.some((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toBe(false);
        const files = await readdir(join(environment.activeServerDir, 'desktop-session-delivery'), { recursive: true });
        expect(files.filter((name) => name.endsWith('.json'))).toEqual([]);
    });

    it('returns the official open failure without dispatching or retaining an undispatched native intent', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        onDiscover = missingOwner;
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            (args[3] as (error: Error | null) => void)(new Error('synthetic launch failure'));
            return {} as ReturnType<typeof execFile>;
        });
        await startRouter();
        const result = await sendDesktopSessionUserMessage({ codexHome, ...input, remoteSessionId: openId, textSendProtocol: 'native-auto-v1' });
        expect(result).toMatchObject({ status: 'rejected', reason: 'desktop_open_failed' });
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(1);
        expect(requests.some((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toBe(false);
        const files = await readdir(join(environment.activeServerDir, 'desktop-session-delivery'), { recursive: true });
        expect(files.filter((name) => name.endsWith('.json'))).toEqual([]);
    });

    it('does not reopen or dispatch when the final recovery discovery still fails', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        let discoveries = 0;
        onDiscover = (request, socket) => {
            discoveries++;
            missingOwner(request, socket);
        };
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input, remoteSessionId: openId, textSendProtocol: 'native-auto-v1' }))
            .toMatchObject({ status: 'rejected', reason: 'owner_unavailable' });
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(discoveries).toBe(2);
        expect(requests.some((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toBe(false);
    });

    it.each(['client-disconnected', 'request-version-mismatch'] as const)('does not open the task for a different cold discovery error (%s)', async (error) => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        onDiscover = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            method: request.method, resultType: 'error', error });
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input, remoteSessionId: openId, textSendProtocol: 'native-auto-v1' }))
            .toMatchObject({ status: 'rejected', reason: error === 'client-disconnected' ? 'owner_changed' : 'incompatible_protocol' });
        expect(execFile).not.toHaveBeenCalled();
        expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(1);
    });

    it.each(['linux', 'attachment'] as const)('keeps the existing cold rejection outside macOS ordinary text (%s)', async (mode) => {
        Object.defineProperty(process, 'platform', { value: mode === 'linux' ? 'linux' : 'darwin' });
        onDiscover = missingOwner;
        const dir = join(root, 'happier/uploads/scope/messages', input.localId);
        await mkdir(dir, { recursive: true });
        const path = join(dir, 'note.txt');
        await writeFile(path, 'note');
        await startRouter();
        const attachments = mode === 'attachment' ? [{ name: 'note.txt', path, kind: 'file' as const, sizeBytes: 4,
            sha256: createHash('sha256').update('note').digest('hex') }] : undefined;
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input, remoteSessionId: openId,
            textSendProtocol: 'native-auto-v1', attachments, attachmentWorkingDirectory: root }))
            .toMatchObject({ status: 'rejected', reason: 'owner_unavailable' });
        expect(execFile).not.toHaveBeenCalled();
        expect(requests.some((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toBe(false);
    });

    it.each(['active', 'inactive'] as const)('uses the confirmed reader owner on a separate text connection when fresh discovery stalls (%s)', async (mode) => {
        let readerSocket: Socket | undefined;
        const follow = onFollow;
        onFollow = (request, socket) => { readerSocket = socket; follow(request, socket); };
        onAction = (request, socket) => {
            expect(socket).not.toBe(readerSocket);
            respond(socket, mode === 'active'
                ? { type: 'response', requestId: request.requestId, method: request.method,
                    resultType: 'success', handledByClientId: 'owner-synthetic', result: { result: { turnId: 'native-current-turn' } } }
                : { type: 'response', requestId: request.requestId, resultType: 'error',
                    error: `Cannot steer conversation ${input.remoteSessionId} because its active turn already ended` });
        };
        await startRouter();
        const followed = await DesktopIpc.open(codexHome);
        await followed.discoverOwner(input.remoteSessionId);
        await followed.readControlSnapshot(input.remoteSessionId, () => {});
        const getFollowedIpc = () => followed;
        // reader 的关联锚仍有效，但新客户端发现不再回复；不能将可读事实等同于新发现成功。
        onDiscover = () => {};
        onHistory = () => {};
        try {
            expect(await getDesktopSessionControl({ codexHome, remoteSessionId: input.remoteSessionId, getFollowedIpc }))
                .toMatchObject({ available: true });
            expect(await getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId, getFollowedIpc }))
                .toMatchObject({ state: 'completed', textSendMode: 'start' });
            // reader 后续大帧尚未收全，文本也必须走另一物理 socket，不能等待正文排空。
            const partialHeader = Buffer.alloc(4);
            partialHeader.writeUInt32LE(1024 * 1024);
            readerSocket!.write(Buffer.concat([partialHeader, Buffer.from('{')]));
            const result = await sendDesktopSessionUserMessage({ codexHome, ...input,
                textSendProtocol: 'native-auto-v1', getFollowedIpc });
            expect(result).toMatchObject({ status: 'accepted', turnId: mode === 'active' ? 'native-current-turn' : 'turn-synthetic' });
            // 第二连接只初始化和定向发送，不跟随或重新水合；原 reader 由原查看者继续持有。
            expect(requests.filter((request) => request.method === 'initialize')).toHaveLength(2);
            expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(1);
            expect(requests.filter((request) => request.method === 'thread-stream-following-changed')).toHaveLength(1);
            expect(requests.filter((request) => request.method === 'thread-follower-load-complete-history')).toHaveLength(1);
            expect(requests.filter((request) => request.method === 'thread-follower-steer-turn')).toHaveLength(1);
            expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(mode === 'inactive' ? 1 : 0);
            expect(followed.isClosed()).toBe(false);
        } finally { followed.close(); }
    });

    it.each(['released', 'owner_disconnected', 'revision_gap', 'continuous_revision'] as const)(
        'rechecks the original reader after text initialization: %s', async (change) => {
            let readerSocket: Socket | undefined;
            const follow = onFollow;
            onFollow = (request, socket) => { readerSocket = socket; follow(request, socket); };
            onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
                method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic',
                result: { result: { turnId: 'native-current-turn' } } });
            await startRouter();
            const followed = await DesktopIpc.open(codexHome);
            await followed.discoverOwner(input.remoteSessionId);
            await followed.readControlSnapshot(input.remoteSessionId, () => {});
            let current: DesktopIpc | null = followed;
            const initialize = onInitialize;
            let pendingInitialize: { request: Request; socket: Socket } | undefined;
            onInitialize = (request, socket) => { pendingInitialize = { request, socket }; };
            const result = sendDesktopSessionUserMessage({ codexHome, ...input, textSendProtocol: 'native-auto-v1',
                getFollowedIpc: () => current });
            try {
                await vi.waitFor(() => expect(pendingInitialize).toBeDefined());
                if (change === 'released') current = null;
                else if (change === 'owner_disconnected') {
                    respond(readerSocket!, { type: 'broadcast', method: 'client-status-changed', version: 0,
                        params: { clientId: 'owner-synthetic', status: 'disconnected' } });
                    await vi.waitFor(() => expect(followed.getControlSnapshot(input.remoteSessionId)).toBeNull());
                } else {
                    respond(readerSocket!, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
                        sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: input.remoteSessionId,
                            change: { type: 'patches', baseRevision: change === 'revision_gap' ? 99 : 1,
                                revision: change === 'revision_gap' ? 100 : 2,
                                patches: [{ op: 'replace', path: ['cwd'], value: '/synthetic-next' }] } } });
                    await vi.waitFor(() => change === 'revision_gap'
                        ? expect(followed.getControlSnapshot(input.remoteSessionId)).toBeNull()
                        : expect(followed.getControlSnapshot(input.remoteSessionId)?.state).toMatchObject({ cwd: '/synthetic-next' }));
                }
                initialize(pendingInitialize!.request, pendingInitialize!.socket);
                expect(await result).toMatchObject(change === 'continuous_revision'
                    ? { status: 'accepted' } : { status: 'rejected', reason: 'owner_changed' });
                expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(1);
                expect(requests.filter((request) => request.method === 'thread-follower-steer-turn'))
                    .toHaveLength(change === 'continuous_revision' ? 1 : 0);
                expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(0);
            } finally { followed.close(); for (const socket of sockets) socket.destroy(); await result; }
        },
    );

    it.each(['initialization', 'inactive'] as const)('honors a disconnect on the borrowed-owner text connection during %s', async (stage) => {
        await startRouter();
        const followed = await DesktopIpc.open(codexHome);
        await followed.discoverOwner(input.remoteSessionId);
        await followed.readControlSnapshot(input.remoteSessionId, () => {});
        const disconnected = { type: 'broadcast', method: 'client-status-changed', version: 0,
            params: { clientId: 'owner-synthetic', status: 'disconnected' } };
        if (stage === 'initialization') onInitialize = (request, socket) => socket.write(Buffer.concat([
            frame({ type: 'response', requestId: request.requestId, method: request.method, resultType: 'success',
                handledByClientId: 'follower-synthetic', result: { clientId: 'follower-synthetic' } }), frame(disconnected),
        ]));
        else onAction = (request, socket) => socket.write(Buffer.concat([
            frame({ type: 'response', requestId: request.requestId, resultType: 'error',
                error: `Cannot steer conversation ${input.remoteSessionId} because its active turn already ended` }), frame(disconnected),
        ]));
        try {
            expect(await sendDesktopSessionUserMessage({ codexHome, ...input, textSendProtocol: 'native-auto-v1',
                getFollowedIpc: () => followed }))
                .toMatchObject({ status: stage === 'initialization' ? 'rejected' : 'unknown', reason: 'owner_changed' });
            expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(1);
            expect(requests.filter((request) => request.method === 'thread-follower-steer-turn')).toHaveLength(stage === 'inactive' ? 1 : 0);
            expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(0);
            expect(followed.getControlSnapshot(input.remoteSessionId)).not.toBeNull();
        } finally { followed.close(); }
    });

    it('does not substitute a valid successor reader while the text connection initializes', async () => {
        await startRouter();
        const followed = await DesktopIpc.open(codexHome);
        await followed.discoverOwner(input.remoteSessionId);
        await followed.readControlSnapshot(input.remoteSessionId, () => {});
        const successor = await DesktopIpc.open(codexHome);
        await successor.discoverOwner(input.remoteSessionId);
        await successor.readControlSnapshot(input.remoteSessionId, () => {});
        let current = followed;
        const initialize = onInitialize;
        onInitialize = (request, socket) => { current = successor; initialize(request, socket); };
        try {
            expect(await sendDesktopSessionUserMessage({ codexHome, ...input, textSendProtocol: 'native-auto-v1',
                getFollowedIpc: () => current })).toMatchObject({ status: 'rejected', reason: 'owner_changed' });
            expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(2);
            expect(requests.filter((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toHaveLength(0);
            expect(followed.getControlSnapshot(input.remoteSessionId)).not.toBeNull();
            expect(successor.getControlSnapshot(input.remoteSessionId)).not.toBeNull();
        } finally { followed.close(); successor.close(); }
    });

    it('starts the same ordinary message once only after the exact native inactive rejection', async () => {
        // 当前原生错误只保留 requestId/error，不带成功回执的 method/handledByClientId。
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            resultType: 'error', error: `Cannot steer conversation ${input.remoteSessionId} because its active turn already ended` });
        await startRouter();
        const message = { codexHome, ...input, textSendProtocol: 'native-auto-v1' as const };
        const first = await sendDesktopSessionUserMessage(message);
        expect(first).toMatchObject({ status: 'accepted', turnId: 'turn-synthetic', receiptPersisted: true });
        expect(await sendDesktopSessionUserMessage(message)).toEqual({ ...first, deduplicated: true });
        const delivery = requests.filter((request) => request.method.startsWith('thread-follower-'));
        expect(delivery.map((request) => request.method)).toEqual(['thread-follower-steer-turn', 'thread-follower-start-turn']);
        expect(delivery[1]).toMatchObject({ version: 2, targetClientId: 'owner-synthetic', params: {
            conversationId: input.remoteSessionId, turnStart: { request: { threadId: input.remoteSessionId,
                clientUserMessageId: input.localId, input: [{ type: 'text', text: input.text, text_elements: [] }] },
            context: { inheritThreadSettings: true } },
        } });
        expect(delivery[0].requestId).not.toBe(delivery[1].requestId);
    });

    it.each(['other_thread', 'raw_backend_error', 'timeout', 'wrong_owner', 'wrong_method', 'missing_turn', 'disconnect'] as const)(
        'does not fall back or replay opted-in text after %s', async (variant) => {
            const inactive = `Cannot steer conversation ${input.remoteSessionId} because its active turn already ended`;
            onAction = (request, socket) => {
                if (variant === 'disconnect') { socket.destroy(); return; }
                respond(socket, { type: 'response', requestId: request.requestId,
                    ...(variant === 'missing_turn' ? { resultType: 'success', method: request.method,
                        handledByClientId: 'owner-synthetic', result: { result: {} } }
                        : { resultType: 'error', error: variant === 'other_thread' ? inactive.replace(input.remoteSessionId, 'other-thread')
                            : variant === 'raw_backend_error' ? 'no active turn to steer' : variant === 'timeout' ? 'request-timeout' : inactive,
                        ...(variant === 'wrong_owner' ? { handledByClientId: 'another-owner' } : {}),
                        ...(variant === 'wrong_method' ? { method: 'thread-follower-start-turn' } : {}) }),
                });
            };
            await startRouter();
            const message = { codexHome, ...input, textSendProtocol: 'native-auto-v1' as const };
            expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'unknown' });
            expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'unknown', deduplicated: true });
            expect(requests.filter((request) => request.method.startsWith('thread-follower-')).map((request) => request.method))
                .toEqual(['thread-follower-steer-turn']);
        },
    );

    it.each(['discovery', 'inactive'] as const)('stops opted-in text when the RPC lifetime is revoked after %s', async (stage) => {
        let revoked = false;
        const discover = onDiscover;
        onDiscover = (request, socket) => { discover(request, socket); if (stage === 'discovery') revoked = true; };
        onAction = (request, socket) => {
            revoked = true;
            respond(socket, { type: 'response', requestId: request.requestId, resultType: 'error',
                error: `Cannot steer conversation ${input.remoteSessionId} because its active turn already ended` });
        };
        await startRouter();
        const result = await sendDesktopSessionUserMessage({ codexHome, ...input, textSendProtocol: 'native-auto-v1',
            getFollowedIpc: () => { if (revoked) throw new DesktopIpcError('owner_changed'); return null; } });
        expect(result).toMatchObject({ status: stage === 'discovery' ? 'rejected' : 'unknown', reason: 'owner_changed' });
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(0);
        expect(requests.filter((request) => request.method === 'thread-follower-steer-turn')).toHaveLength(stage === 'discovery' ? 0 : 1);
    });

    it('does not start after an inactive rejection followed by an owner disconnect in the same batch', async () => {
        onAction = (request, socket) => socket.write(Buffer.concat([
            frame({ type: 'response', requestId: request.requestId, resultType: 'error',
                error: `Cannot steer conversation ${input.remoteSessionId} because its active turn already ended` }),
            frame({ type: 'broadcast', method: 'client-status-changed', version: 0, sourceClientId: 'owner-synthetic',
                params: { clientId: 'owner-synthetic', status: 'disconnected' } }),
        ]));
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input, textSendProtocol: 'native-auto-v1' }))
            .toMatchObject({ status: 'unknown', reason: 'owner_changed' });
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(0);
    });

    it('keeps a lost start acknowledgement unknown after definite inactive and never repeats either send', async () => {
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            resultType: 'error', error: `Cannot steer conversation ${input.remoteSessionId} because its active turn already ended` });
        onStart = (_request, socket) => socket.destroy();
        await startRouter();
        const message = { codexHome, ...input, textSendProtocol: 'native-auto-v1' as const };
        expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'unknown' });
        expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'unknown', deduplicated: true });
        expect(requests.filter((request) => request.method.startsWith('thread-follower-')).map((request) => request.method))
            .toEqual(['thread-follower-steer-turn', 'thread-follower-start-turn']);
    });

    // 检查完整线上形状、目标身份和消息身份的字节保持。
    it('requires an owner response containing a turn id and preserves the exact localId', async () => {
        await startRouter();
        const result = await sendDesktopSessionUserMessage({ codexHome, ...input });
        expect(result).toMatchObject({ status: 'accepted', localId: input.localId, remoteSessionId: input.remoteSessionId,
            ownerClientId: 'owner-synthetic', turnId: 'turn-synthetic', deduplicated: false });
        const start = requests.find((request) => request.method === 'thread-follower-start-turn');
        expect(start).toMatchObject({ version: 2, targetClientId: 'owner-synthetic', sourceClientId: 'follower-synthetic',
            params: { conversationId: input.remoteSessionId, turnStart: { request: {
                threadId: input.remoteSessionId, clientUserMessageId: input.localId,
                input: [{ type: 'text', text: input.text, text_elements: [] }],
            }, context: { inheritThreadSettings: true } } } });
        expect(start).not.toHaveProperty('hostId');
        expect(requests.findIndex((request) => request.method === 'thread-stream-following-changed' && request.params.following === true)).toBeGreaterThanOrEqual(0);
        expect(requests.findIndex((request) => request.method === 'thread-stream-following-changed' && request.params.following === true))
            .toBeLessThan(requests.findIndex((request) => request.method === 'thread-follower-start-turn'));
    });

    // 即使 UI 刚刚读到 idle，真正发送仍在同一个 owner 连接内重新取事实，忙时不降级投递。
    it('rejects start when the original owner became busy after the UI read idle', async () => {
        await startRouter();
        expect(await getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }))
            .toMatchObject({ textSendMode: 'start' });
        onFollow = (request, socket) => {
            if (request.params.following) respond(socket, controlSnapshotFrame({ ...idleControlState(),
                threadRuntimeStatus: { type: 'active' }, turns: [{ turnId: 'new-turn', status: 'inProgress', items: [] }] }));
        };
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input })).toMatchObject({ status: 'rejected', reason: 'turn_not_idle' });
        expect(requests.some((request) => request.method === 'thread-follower-start-turn' || request.method === 'thread-follower-steer-turn')).toBe(false);
    });

    // 原始状态即便还能展示，没有模式证明也不允许经过公共发送入口投递。
    it.each(['runtime_missing', 'active_terminal', 'unconfirmed'])('rejects %s before dispatching start', async (variant) => {
        onFollow = (request, socket) => {
            const state = idleControlState();
            if (variant === 'runtime_missing') delete state.threadRuntimeStatus;
            if (variant === 'active_terminal') state.threadRuntimeStatus = { type: 'active' };
            if (variant === 'unconfirmed') state.unconfirmedTurnSubmissions = [{ requestId: 'prior-submission' }];
            if (request.params.following) respond(socket, controlSnapshotFrame(state));
        };
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input })).toMatchObject({ status: 'rejected' });
        expect(requests.some((request) => request.method === 'thread-follower-start-turn')).toBe(false);
    });

    // Promise 已由快照 resolve 时，同批后续断线仍必须撤回本次控制证明。
    it('rejects a control snapshot and start when the owner disconnects in the same incoming batch', async () => {
        onFollow = (request, socket) => {
            if (request.params.following) socket.write(Buffer.concat([
                frame(controlSnapshotFrame(idleControlState())),
                frame({ type: 'broadcast', method: 'client-status-changed', version: 0, sourceClientId: 'owner-synthetic',
                    params: { clientId: 'owner-synthetic', status: 'disconnected' } }),
            ]));
        };
        await startRouter();
        await expect(getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId })).rejects.toThrow('owner_changed');
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input })).toMatchObject({ status: 'rejected', reason: 'owner_changed' });
        expect(requests.some((request) => request.method === 'thread-follower-start-turn')).toBe(false);
    });

    // await 恢复前已收到连续忙态补丁时，控制读取不能继续返回同批前一帧的 idle。
    it('uses the latest owner state when an idle snapshot and busy patches arrive in the same batch', async () => {
        onFollow = (request, socket) => {
            if (request.params.following) socket.write(Buffer.concat([
                frame(controlSnapshotFrame(idleControlState())),
                frame({ type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
                    params: { hostId: 'local', conversationId: input.remoteSessionId, change: { type: 'patches', baseRevision: 1, revision: 2,
                        patches: [{ op: 'replace', path: ['threadRuntimeStatus'], value: { type: 'active' } },
                            { op: 'add', path: ['turns', 1], value: { turnId: 'new-busy-turn', status: 'inProgress', items: [] } }] } } }),
            ]));
        };
        await startRouter();
        expect(await getDesktopSessionControlSnapshot({ codexHome, remoteSessionId: input.remoteSessionId }))
            .toMatchObject({ textSendMode: 'steer', turnId: 'new-busy-turn' });
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input })).toMatchObject({ status: 'rejected', reason: 'turn_not_idle' });
        expect(requests.some((request) => request.method === 'thread-follower-start-turn')).toBe(false);
    });

    // 公开控制 API 拒绝同连接的并发替换，不能让另一目标或新代次夺走原快照 listener。
    it.each(['thread-synthetic', 'other-thread'])('keeps the original control subscription when a concurrent %s read is attempted', async (otherConversation) => {
        let followedSocket: Socket | undefined;
        onFollow = (request, socket) => { if (request.params.following) followedSocket = socket; };
        await startRouter();
        const ipc = await DesktopIpc.open(codexHome);
        try {
            await ipc.discoverOwner(input.remoteSessionId);
            const originalRead = ipc.readControlSnapshot(input.remoteSessionId);
            // 先挂 rejection handler，失败版本在等待旧 listener 时也不能产生未处理拒绝。
            const originalResult = originalRead.then((state) => ({ state }), (error: unknown) => ({ error }));
            await vi.waitFor(() => expect(followedSocket).toBeDefined());
            await expect(ipc.readControlSnapshot(otherConversation)).rejects.toThrow('owner_unavailable');
            respond(followedSocket!, controlSnapshotFrame(idleControlState()));
            expect(await originalResult).toMatchObject({ state: { id: input.remoteSessionId } });
        } finally { ipc.close(); }
    });

    // steer 也只能消费当前生产者证明，不能只凭旧 running 状态绕过未确认提交保护。
    it('rejects steer without a current text send mode even when the turn still says running', async () => {
        onFollow = (request, socket) => {
            if (request.params.following) respond(socket, controlSnapshotFrame({ ...idleControlState(),
                threadRuntimeStatus: { type: 'active' }, turns: [{ turnId: 'busy-turn', status: 'inProgress', items: [] }],
                unconfirmedTurnSubmissions: [{ requestId: 'prior-submission' }] }));
        };
        await startRouter();
        expect(await performDesktopSessionControlAction({ codexHome, remoteSessionId: input.remoteSessionId, accountId: input.accountId,
            action: { kind: 'steer', machineId: 'machine-1', sessionId: 'linked-1', operationId: 'steer-blocked', expectedTurnId: 'busy-turn', text: 'synthetic' } }))
            .toMatchObject({ status: 'rejected' });
        expect(requests.some((request) => request.method === 'thread-follower-steer-turn')).toBe(false);
    });

    // 未派发的失败只释放本次意图，用户手动重试仍复用相同身份和正文。
    it.each(['legacy', 'native'] as const)('allows the same localId after an undispatched %s rejection recovers', async (mode) => {
        // 非 macOS 不唤起官方任务入口，仍覆盖原手动重试释放意图的契约。
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const discover = onDiscover;
        onDiscover = missingOwner;
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            method: request.method, resultType: 'success', handledByClientId: 'owner-synthetic',
            result: { result: { turnId: 'native-current-turn' } } });
        await startRouter();
        const message = { codexHome, ...input, ...(mode === 'native' ? { textSendProtocol: 'native-auto-v1' as const } : {}) };
        expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'rejected', reason: 'owner_unavailable', deduplicated: false });
        expect(requests.some((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toBe(false);
        const files = await readdir(join(environment.activeServerDir, 'desktop-session-delivery'), { recursive: true });
        expect(files.filter((name) => name.endsWith('.json'))).toEqual([]);
        onDiscover = discover;
        const recovered = await sendDesktopSessionUserMessage(message);
        expect(recovered).toMatchObject({ status: 'accepted', localId: input.localId, deduplicated: false });
        expect(recovered).not.toHaveProperty('undispatched');
        expect(await sendDesktopSessionUserMessage(message)).toEqual({ ...recovered, deduplicated: true });
        expect(requests.filter((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method)))
            .toHaveLength(1);
        expect(execFile).not.toHaveBeenCalled();
    });

    // request 调用后的明确拒绝与未知都保留原意图；不能仅看 status 为 rejected 就释放。
    it.each(['unknown', 'rejected'] as const)('keeps the intent and never reissues native text after a dispatched %s outcome', async (status) => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await writeOpenTarget();
        vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
            (args[3] as (error: Error | null) => void)(null);
            return {} as ReturnType<typeof execFile>;
        });
        onAction = (request, socket) => respond(socket, { type: 'response', requestId: request.requestId,
            resultType: 'error', error: status === 'unknown' ? 'request-timeout' : 'no-client-found' });
        await startRouter();
        const message = { codexHome, ...input, remoteSessionId: openId, textSendProtocol: 'native-auto-v1' as const };
        const first = await sendDesktopSessionUserMessage(message);
        expect(first).toMatchObject({ status });
        const store = join(environment.activeServerDir, 'desktop-session-delivery');
        const intent = (await readdir(store, { recursive: true })).find((name) => name.endsWith('.intent.json'))!;
        const originalIntent = await readFile(join(store, intent), 'utf8');
        expect(await sendDesktopSessionUserMessage(message)).toEqual({ ...first, deduplicated: true });
        expect(await readFile(join(store, intent), 'utf8')).toBe(originalIntent);
        expect(requests.filter((request) => request.method === 'thread-follower-steer-turn')).toHaveLength(1);
        expect(execFile).not.toHaveBeenCalled();
    });

    // EEXIST 不得清理正在发送的意图；失败清理也必须重新匹配本次 requestId。
    it('preserves another request intent and does not overwrite its receipt after an undispatched rejection', async () => {
        // 固定非 macOS，使合成的非 UUID 任务继续验证独占意图本身，不触发官方入口。
        Object.defineProperty(process, 'platform', { value: 'linux' });
        let discovery: { request: Request; socket: Socket } | undefined;
        onDiscover = (request, socket) => { discovery = { request, socket }; };
        await startRouter();
        const message = { codexHome, ...input, textSendProtocol: 'native-auto-v1' as const };
        const pending = sendDesktopSessionUserMessage(message);
        try {
            await vi.waitFor(() => expect(discovery).toBeDefined());
            const store = join(environment.activeServerDir, 'desktop-session-delivery');
            const intent = (await readdir(store, { recursive: true })).find((name) => name.endsWith('.intent.json'))!;
            const path = join(store, intent);
            const originalIntent = await readFile(path, 'utf8');
            expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'unknown', deduplicated: true });
            expect(await readFile(path, 'utf8')).toBe(originalIntent);
            const replacement = { ...JSON.parse(originalIntent), requestId: 'another-request' };
            await writeProtectedLocalStateFileAtomic(path, JSON.stringify(replacement));
            const receiptPath = path.replace('.intent.json', '.receipt.json');
            const receipt = { ...input, status: 'unknown', reason: 'delivery_outcome_unknown', requestId: replacement.requestId };
            await writeProtectedLocalStateFileAtomic(receiptPath, JSON.stringify(receipt));
            missingOwner(discovery!.request, discovery!.socket);
            expect(await pending).toMatchObject({ status: 'rejected', reason: 'owner_unavailable' });
            expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(replacement);
            expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toEqual(receipt);
            expect(await sendDesktopSessionUserMessage(message)).toMatchObject({ status: 'unknown', requestId: 'another-request', deduplicated: true });
            expect(requests.filter((request) => request.method === 'thread-owner-discovery')).toHaveLength(1);
            expect(requests.some((request) => ['thread-follower-start-turn', 'thread-follower-steer-turn'].includes(request.method))).toBe(false);
        } finally {
            for (const socket of sockets) socket.destroy();
            await pending;
        }
    });

    // 写成功后断线仍是未知；重复请求不能造成第二次执行。
    it('does not treat a successful write or disconnected response as acceptance and never replays it', async () => {
        onStart = (_request, socket) => socket.destroy();
        await startRouter();
        const first = await sendDesktopSessionUserMessage({ codexHome, ...input });
        expect(first).toMatchObject({ status: 'unknown', localId: input.localId });
        const second = await sendDesktopSessionUserMessage({ codexHome, ...input });
        expect(second).toMatchObject({ status: 'unknown', deduplicated: true });
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(1);
    });

    // 重载模块模拟进程内存消失，回执必须由文件恢复并识别正文冲突。
    it('replays a durable accepted receipt and rejects a conflicting duplicate without sending', async () => {
        await startRouter();
        const first = await sendDesktopSessionUserMessage({ codexHome, ...input });
        vi.resetModules();
        const restarted = await import('./desktopSessionControl');
        expect(await restarted.sendDesktopSessionUserMessage({ codexHome, ...input }))
            .toEqual({ ...first, deduplicated: true });
        expect(await restarted.sendDesktopSessionUserMessage({ codexHome, ...input, text: 'conflicting text' }))
            .toMatchObject({ status: 'rejected', reason: 'local_id_conflict', deduplicated: true });
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(1);
    });

    // 并发调用经过真实独占文件创建，最多只能向 owner 提交一次。
    it('cannot concurrently submit the same localId twice', async () => {
        await startRouter();
        const results = await Promise.all(Array.from({ length: 4 }, () => sendDesktopSessionUserMessage({ codexHome, ...input })));
        expect(results.some((result) => result.status === 'accepted')).toBe(true);
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(1);
    });

    // 即便外层宣称成功，证据不完整或身份不一致都不能算接受。
    it.each(['missing_turn', 'wrong_owner', 'wrong_method'])('keeps %s responses unknown rather than accepted', async (variant) => {
        onStart = (request, socket) => respond(socket, {
            type: 'response', requestId: request.requestId,
            method: variant === 'wrong_method' ? 'thread-follower-steer-turn' : request.method,
            resultType: 'success', handledByClientId: variant === 'wrong_owner' ? 'another-owner' : 'owner-synthetic',
            result: variant === 'missing_turn' ? { result: {} } : { result: { turn: { id: 'turn-synthetic' } } },
        });
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input })).toMatchObject({ status: 'unknown' });
    });

    // router 明确找不到目标时直接拒绝，不创建替代执行器。
    it('rejects no-client-found without falling back to a local executor', async () => {
        onStart = (request, socket) => respond(socket, {
            type: 'response', requestId: request.requestId, resultType: 'error', error: 'no-client-found',
        });
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input }))
            .toMatchObject({ status: 'rejected', reason: 'owner_unavailable' });
        expect(requests.filter((request) => request.type === 'request').map((request) => request.method))
            .toEqual(['initialize', 'thread-owner-discovery', 'thread-follower-load-complete-history', 'thread-follower-start-turn']);
    });

    // 未证明支持当前协议的 owner 不能被宣告为可发送。
    it('reports unavailable when discovery does not prove the supported owner contract', async () => {
        onDiscover = (request, socket) => respond(socket, {
            type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'owner-synthetic', result: {},
        });
        await startRouter();
        expect(await getDesktopSessionControl({ codexHome, remoteSessionId: input.remoteSessionId }))
            .toMatchObject({ available: false, reason: 'incompatible_protocol' });
        expect(requests.some((request) => request.method === 'thread-follower-start-turn')).toBe(false);
    });

    // 同批响应和失联通知必须共同决定可用性，不能依赖 await 的恢复时序。
    it('does not submit when the discovered owner disconnected in the same incoming frame batch', async () => {
        onDiscover = (request, socket) => socket.write(Buffer.concat([
            frame({ type: 'response', requestId: request.requestId, method: request.method,
                resultType: 'success', handledByClientId: 'owner-synthetic', result: { supportsUntrustedAppInput: true } }),
            frame({ type: 'broadcast', method: 'client-status-changed', version: 0, sourceClientId: 'owner-synthetic',
                params: { clientId: 'owner-synthetic', status: 'disconnected' } }),
        ]));
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input }))
            .toMatchObject({ status: 'rejected', reason: 'owner_changed' });
        expect(requests.some((request) => request.method === 'thread-follower-start-turn')).toBe(false);
    });

    // 相同方法的别次成功应答不是本次发送的接受证据。
    it('ignores an unrelated success response and waits for the matching request', async () => {
        onStart = (request, socket) => {
            accepted({ ...request, requestId: 'unrelated-request' }, socket);
            respond(socket, { type: 'response', requestId: request.requestId, resultType: 'error', error: 'no-client-found' });
        };
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input }))
            .toMatchObject({ status: 'rejected', reason: 'owner_unavailable' });
    });

    // 超时沿用当前 Desktop 期限，未决意图不会自动重投。
    it('keeps a missing response unknown after the Desktop request deadline', async () => {
        // 真实 socket 保持打开但不回应，复现已发送且结果不可判定的边界。
        onStart = () => undefined;
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input }))
            .toMatchObject({ status: 'unknown', reason: 'timeout' });
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input }))
            .toMatchObject({ status: 'unknown', deduplicated: true });
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(1);
    });

    // 只读发现不应在 Codex 目录内创建任何内容。
    it('does not create a missing router or mutate the supplied Codex directory', async () => {
        await mkdir(codexHome);
        expect(await getDesktopSessionControl({ codexHome, remoteSessionId: input.remoteSessionId }))
            .toMatchObject({ available: false, reason: 'router_unavailable' });
        expect(await readdir(codexHome)).toEqual([]);
    });

    // 不支持的平台必须在任何持久化副作用前明确退出。
    it('rejects unsupported platforms before writing delivery state', async () => {
        await mkdir(codexHome);
        const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
        try {
            // OS 是真正外部边界；账号已由上游固定，Windows 必须在持久化之前退出。
            Object.defineProperty(process, 'platform', { value: 'win32' });
            expect(await sendDesktopSessionUserMessage({ codexHome, ...input }))
                .toMatchObject({ status: 'rejected', reason: 'unsupported_platform' });
        } finally { Object.defineProperty(process, 'platform', original); }
        expect(await readdir(root)).toEqual(['codex']);
    });

    // 无效帧不能产生成功回执，也不能清除已经落盘的意图。
    it('does not accept a malformed frame or retry its uncertain submission', async () => {
        onStart = (_request, socket) => socket.write(Buffer.alloc(4));
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input }))
            .toMatchObject({ status: 'unknown', reason: 'invalid_response' });
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input }))
            .toMatchObject({ status: 'unknown', deduplicated: true });
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(1);
    });

    // 同一 server 下账号切换不能读取前一账号的接受证据。
    it('does not reveal another account receipt under the same server', async () => {
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input })).toMatchObject({ status: 'accepted' });
        onDiscover = (request, socket) => respond(socket, {
            type: 'response', requestId: request.requestId, resultType: 'error', error: 'no-client-found',
        });
        const other = await sendDesktopSessionUserMessage({ codexHome, ...input, accountId: 'second-account' });
        expect(other).toMatchObject({ status: 'rejected', reason: 'owner_unavailable', deduplicated: false });
        expect(other).not.toHaveProperty('turnId');
    });

    // 崩溃窗口或损坏回执无法证明未执行，保留未知且不重投。
    it('retains a restart-unknown intent even when the process ended before writing a receipt', async () => {
        onStart = (_request, socket) => socket.destroy();
        await startRouter();
        expect(await sendDesktopSessionUserMessage({ codexHome, ...input })).toMatchObject({ status: 'unknown' });
        const store = join(environment.activeServerDir, 'desktop-session-delivery');
        const [account] = await readdir(store);
        const entries = await readdir(join(store, account));
        const intent = entries.find((entry) => entry.endsWith('.intent.json'))!;
        expect(await readFile(join(store, account, intent), 'utf8')).not.toContain(input.text);
        // 独占意图是恢复边界；损坏/丢失结果也不能当成可以重发的新消息。
        const receipt = entries.find((entry) => entry.endsWith('.receipt.json'));
        if (receipt) await writeFile(join(store, account, receipt), '{');
        vi.resetModules();
        const restarted = await import('./desktopSessionControl');
        expect(await restarted.sendDesktopSessionUserMessage({ codexHome, ...input }))
            .toMatchObject({ status: 'unknown', deduplicated: true });
        expect(requests.filter((request) => request.method === 'thread-follower-start-turn')).toHaveLength(1);
    });
});
