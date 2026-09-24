import { createServer, type Server, type Socket } from 'node:net';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';

const environment = vi.hoisted(() => ({ activeServerDir: '' }));
// 配置是环境边界；内部去重、文件持久化和 IPC 解析都执行真实实现。
vi.mock('@/configuration', () => ({ configuration: environment }));

import { getDesktopSessionControl, getDesktopSessionControlSnapshot, sendDesktopSessionUserMessage, performDesktopSessionControlAction } from './desktopSessionControl';
import { readDesktopControlSnapshot } from './desktopControlSnapshot';
import { DesktopIpc } from './desktopIpc';

type Request = {
    type: string;
    requestId: string;
    method: string;
    version: number;
    sourceClientId: string;
    targetClientId?: string;
    hostId?: string;
    params: Record<string, unknown>;
};

// 合成帧依据 Desktop 26.917.51856 (10492) 的 src-mOb8On4V.js / main-9ZiZs9Y1.js。
// 它验证已观察的方法版本与结构，不将安装版本冒充正在运行 owner 的认证。
describe('Desktop-owned session control', () => {
    let root: string;
    let codexHome: string;
    let server: Server | undefined;
    let requests: Request[];
    const sockets = new Set<Socket>();
    let onStart: (request: Request, socket: Socket) => void;
    let onDiscover: (request: Request, socket: Socket) => void;
    let onFollow: (request: Request, socket: Socket) => void;
    let onAction: (request: Request, socket: Socket) => void;
    const input = { remoteSessionId: 'thread-synthetic', text: 'synthetic prompt', localId: 'message-synthetic', accountId: 'account-synthetic' };

    /** 独立编码外部协议帧，让单次 write 可以重现同一批内的 owner 失联。 */
    function frame(value: unknown): Buffer {
        const body = Buffer.from(JSON.stringify(value));
        const header = Buffer.alloc(4);
        header.writeUInt32LE(body.length);
        return Buffer.concat([header, body]);
    }

    /** 用独立编码的外部边界帧模拟 Desktop，刻意拆分帧头和正文。 */
    function respond(socket: Socket, value: unknown): void {
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
    async function startRouter(): Promise<void> {
        await mkdir(join(codexHome, 'ipc'), { recursive: true, mode: 0o700 });
        server = createServer((socket) => {
            sockets.add(socket);
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
                        respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
                            resultType: 'success', handledByClientId: 'follower-synthetic', result: { clientId: 'follower-synthetic' } });
                    } else if (request.method === 'thread-owner-discovery') {
                        onDiscover(request, socket);
                    } else if (request.method === 'thread-follower-start-turn') {
                        onStart(request, socket);
                    } else if (request.method === 'thread-stream-following-changed') {
                        onFollow(request, socket);
                    } else if (request.method.startsWith('thread-follower-')) {
                        onAction(request, socket);
                    }
                }
            });
        });
        await new Promise<void>((resolve, reject) => {
            server!.once('error', reject);
            server!.listen(join(codexHome, 'ipc', 'ipc.sock'), resolve);
        });
    }

    /** 每例隔离 Happier 意图文件和 Codex 模拟目录。 */
    beforeEach(async () => {
        root = await createTempDir('hcd-');
        codexHome = join(root, 'codex');
        environment.activeServerDir = join(root, 'happier');
        requests = [];
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
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = undefined;
        await removeTempDir(root);
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
        let ownerSocket!: Socket;
        const snapshot = (revision: number, turns: Array<{ turnId: string; status: string }>) => respond(ownerSocket, {
            type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-synthetic',
            params: { hostId: 'local', conversationId: input.remoteSessionId, change: { type: 'snapshot', revision, conversationState: {
                id: input.remoteSessionId, requests: [], turns: [], historyMode: 'paginated', canonicalVoiceHistory: true,
                threadRuntimeStatus: { type: 'idle' }, paginatedHistory: { itemsBackwardsCursor: 'synthetic' },
                turnHistory: { kind: 'canonical', history: { generation: 0, isComplete: true,
                    entitiesByKey: Object.fromEntries(turns.map((turn) => [turn.turnId, { ...turn, items: [] }])),
                    islands: [{ id: 'tail:0', entries: turns.map((turn) => ({ key: turn.turnId, value: turn.turnId })),
                        olderBoundary: { status: 'exhausted' }, newerBoundary: { status: 'exhausted' } }],
                } },
            } } },
        });
        onFollow = (request, socket) => {
            ownerSocket = socket;
            if (request.params.following) snapshot(258, [{ turnId: 'old', status: 'completed' }]);
        };
        ipc.followConversation(input.remoteSessionId, (value) => observations.push(value));
        await vi.waitFor(() => expect(observations).toHaveLength(2));
        expect(observations.at(-1)).toMatchObject({ state: 'unknown' });
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
        snapshot(294, [{ turnId: 'old', status: 'completed' }, { turnId: 'unrelated', status: 'completed' }, { turnId: 'current', status: 'inProgress' }]);
        await vi.waitFor(() => expect(observations.at(-1)).toMatchObject({ state: 'running', turnId: 'current' }));
        snapshot(295, [{ turnId: 'old', status: 'completed' }]);
        await vi.waitFor(() => expect(observations).toHaveLength(7));
        expect(observations.at(-1)).toMatchObject({ state: 'unknown' });
        ipc.close();
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
            .toEqual(['initialize', 'thread-owner-discovery', 'thread-follower-start-turn']);
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
