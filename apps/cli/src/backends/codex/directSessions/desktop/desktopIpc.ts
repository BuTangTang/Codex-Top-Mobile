import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { applyPatches, enablePatches, type Patch } from 'immer';
import type { DirectSessionObservationV1, DirectSessionObservationUnknownReason } from '@happier-dev/protocol';
import { readDesktopConversationObservation } from './desktopConversationObservation';

// Desktop 使用标准 Immer patches；依赖由 CLI 正式声明，不实现私有补丁替代器。
enablePatches();

// 私有协议证据：Desktop 26.917.51856 (10492)，src-mOb8On4V.js。
// 方法版本/帧上限/超时来自该客户端；版本匹配不代表运行构建已认证。
// 同类协议参考：Emanuele-web04/remodex@e0e342dac5cddd40db661bfcf76e5ab0e3913ef8。
// 这里独立实现协议边界，没有复制 Remodex 实现。
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_FRAME_BYTES = 268_435_456;

export type DesktopIpcResponse = Record<string, unknown>;
type KnownObservation = Exclude<DirectSessionObservationV1, { state: 'unknown' }>;

/** 只比较明确生命周期字段；正文、时间戳和 revision 前进都不是当前状态证明。 */
function observationKey(value: KnownObservation): string {
    return JSON.stringify([value.turnId, value.state, value.state === 'needs_input'
        ? value.requests.map((request) => `${request.kind}:${request.requestId}`).sort() : []]);
}

/** 新尾轮必须和基线轮同处一个已加载、没有间隙的尾岛，并明确排在基线之后。 */
function followsObservedTurn(state: unknown, previousTurnId: string, nextTurnId: string): boolean {
    const value = ipcRecord(state);
    const container = ipcRecord(value?.turnHistory);
    let turns: unknown[];
    if (container?.kind === 'canonical') {
        const history = ipcRecord(container.history);
        const islands = history?.islands;
        const island = Array.isArray(islands) ? ipcRecord(islands.at(-1)) : null;
        if (ipcRecord(island?.newerBoundary)?.status !== 'exhausted' || !Array.isArray(island?.entries)) return false;
        const entities = ipcRecord(history?.entitiesByKey);
        turns = island.entries.map((entry) => entities?.[String(ipcRecord(entry)?.value)]);
    } else turns = Array.isArray(value?.turns) ? value.turns : [];
    const ids = turns.map((turn) => ipcRecord(turn)?.turnId);
    const previous = ids.indexOf(previousTurnId);
    return previous >= 0 && previous < ids.length - 1 && ids.at(-1) === nextTurnId;
}

/** 同轮只接受尚未终止时的状态/请求变化，换轮须有连续尾部顺序。 */
function hasLifecycleProgress(previous: KnownObservation, next: KnownObservation, state: unknown): boolean {
    return previous.turnId === next.turnId
        ? !['completed', 'failed', 'cancelled'].includes(previous.state) && observationKey(previous) !== observationKey(next)
        : followsObservedTurn(state, previous.turnId, next.turnId);
}

/** 仅携带稳定原因，不传播 Desktop 原始异常中的正文或路径。 */
export class DesktopIpcError extends Error {
    readonly reason: string;
    /** 保存调用方可分类的协议/传输失败。 */
    constructor(reason: string) {
        super(reason);
        this.reason = reason;
    }
}

/** 在 JSON 边界收窄对象，拒绝数组和空值。 */
export function ipcRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

/** 验证协议标识非空，同时保留原始字节。 */
export function ipcString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** 当前只使用已核对的 Unix socket 协议；其余平台在任何副作用前退出。 */
export function assertDesktopPlatform(): void {
    if (process.platform !== 'darwin' && process.platform !== 'linux') throw new DesktopIpcError('unsupported_platform');
}

/** 把有限的明确拒绝转成稳定原因；其余远端异常可能发生在提交后。 */
export function desktopResponseFailure(response: DesktopIpcResponse): string {
    if (response.error === 'no-client-found') return 'owner_unavailable';
    if (response.error === 'request-version-mismatch' || response.error === 'no-handler-for-request') return 'incompatible_protocol';
    if (response.error === 'client-disconnected') return 'owner_changed';
    if (response.error === 'request-timeout') return 'timeout';
    return 'remote_outcome_unknown';
}

/** 单次调用的 follower 连接；只连已有 router，永不成为会话 owner。 */
export class DesktopIpc {
    private readonly socket: Socket;
    private clientId = 'initializing-client';
    private bytes: Buffer = Buffer.alloc(0);
    private failure: DesktopIpcError | null = null;
    private ownerClientId: string | null = null;
    private observation: { conversationId: string; listener: (observation: DirectSessionObservationV1, continuity: 'snapshot' | 'event') => void;
        revision: number | null; state: unknown; anchor: KnownObservation | null; confirmed: boolean } | null = null;
    private readonly disconnectedClients = new Set<string>();
    private controlSnapshotListener: ((snapshot: unknown) => void) | null = null;
    private readonly pending = new Map<string, {
        resolve: (response: DesktopIpcResponse) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    /** 监听真实 socket 的分帧、关闭和错误，不重连、不重发。 */
    private constructor(socket: Socket) {
        this.socket = socket;
        socket.on('data', (chunk: Buffer) => this.readFrames(chunk));
        socket.on('error', () => this.fail('connection_closed'));
        socket.on('close', () => this.fail('connection_closed'));
    }

    /** 先验证 socket 所有者，再初始化协议；不创建目录或 router。 */
    static async open(codexHome: string): Promise<DesktopIpc> {
        assertDesktopPlatform();
        const directory = join(codexHome, 'ipc');
        const path = join(directory, 'ipc.sock');
        try {
            const [parent, socketInfo] = await Promise.all([lstat(directory), lstat(path)]);
            const uid = process.getuid?.();
            if (uid === undefined || !parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== uid
                || (parent.mode & 0o077) !== 0 || !socketInfo.isSocket() || socketInfo.uid !== uid) {
                throw new DesktopIpcError('untrusted_router');
            }
        } catch (error) {
            if (error instanceof DesktopIpcError) throw error;
            throw new DesktopIpcError('router_unavailable');
        }
        const socket = connect(path);
        const ipc = new DesktopIpc(socket);
        try {
            // 沿用 Desktop 客户端的请求期限，不无限等待失效 socket。
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new DesktopIpcError('timeout')), REQUEST_TIMEOUT_MS);
                socket.once('connect', () => { clearTimeout(timer); resolve(); });
                socket.once('error', () => { clearTimeout(timer); reject(new DesktopIpcError('router_unavailable')); });
                socket.once('close', () => { clearTimeout(timer); reject(new DesktopIpcError('connection_closed')); });
            });
            const response = await ipc.request('initialize', 0, { clientType: 'happier-desktop-follower' });
            const result = ipcRecord(response.result);
            if (response.resultType !== 'success' || response.method !== 'initialize'
                || !ipcString(result?.clientId) || response.handledByClientId !== result.clientId) {
                throw new DesktopIpcError('incompatible_protocol');
            }
            ipc.clientId = result.clientId;
            return ipc;
        } catch (error) {
            ipc.close();
            throw error;
        }
    }

    /** 发现原 owner 后固定其身份，断连广播立即使本次连接失效。 */
    async discoverOwner(remoteSessionId: string): Promise<string> {
        const response = await this.request('thread-owner-discovery', 1, { hostId: 'local', conversationId: remoteSessionId });
        if (response.resultType === 'error') throw new DesktopIpcError(desktopResponseFailure(response));
        const result = ipcRecord(response.result);
        if (response.resultType !== 'success' || response.method !== 'thread-owner-discovery'
            || !ipcString(response.handledByClientId) || response.handledByClientId === this.clientId
            || result?.supportsUntrustedAppInput !== true) throw new DesktopIpcError('incompatible_protocol');
        this.ownerClientId = response.handledByClientId;
        // 发现应答与断连广播可能在同一个 data 回调中到达，早于 await 恢复。
        if (this.disconnectedClients.has(this.ownerClientId)) throw new DesktopIpcError('owner_changed');
        if (this.failure) throw this.failure;
        return this.ownerClientId;
    }

    /** 只订阅原 owner 的状态；不请求 owner 身份、不创建或恢复会话。 */
    followConversation(conversationId: string, listener: (observation: DirectSessionObservationV1, continuity: 'snapshot' | 'event') => void): () => void {
        if (this.failure) throw this.failure;
        if (!this.ownerClientId || this.observation) throw new DesktopIpcError('owner_unavailable');
        this.observation = { conversationId, listener, revision: null, state: null, anchor: null, confirmed: false };
        listener({ v: 1, state: 'unknown', reason: 'not_observed' }, 'snapshot');
        this.write({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1,
            sourceClientId: this.clientId, targetClientIds: [this.ownerClientId],
            params: { hostId: 'local', conversationId, following: true } });
        return () => {
            this.observation = null;
            if (!this.failure) this.write({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1,
                sourceClientId: this.clientId, targetClientIds: [this.ownerClientId],
                params: { hostId: 'local', conversationId, following: false } });
        };
    }

    /** 返回本次订阅已应用的最新原 owner 状态；失联、并发替换或目标变化均不留下控制证明。 */
    async readControlSnapshot(conversationId: string): Promise<unknown> {
        // 先拒绝并发读取，避免失败的新调用覆盖或清理仍在等待的原 listener。
        const existingSubscription = this.observation;
        if (this.controlSnapshotListener || existingSubscription) throw new DesktopIpcError('owner_unavailable');
        let stop: (() => void) | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const ready = new Promise<void>((resolve, reject) => {
                timer = setTimeout(() => reject(new DesktopIpcError('timeout')), REQUEST_TIMEOUT_MS);
                this.controlSnapshotListener = () => resolve();
                stop = this.followConversation(conversationId, () => {});
            });
            const subscribed = this.observation;
            await ready;
            // 同一 data 批可先给快照、再给补丁或断线；只读取原订阅最新状态，不捕获首帧对象。
            if (this.failure) throw this.failure;
            if (!subscribed || this.observation !== subscribed || subscribed.conversationId !== conversationId
                || !ipcRecord(subscribed.state)) throw new DesktopIpcError('invalid_snapshot');
            return subscribed.state;
        } finally {
            if (timer) clearTimeout(timer);
            this.controlSnapshotListener = null;
            stop?.();
        }
    }

    /** 校验来源、版本、目标与连续 revision 后才应用补丁。缺口关闭当前代次，等待上层重新发现。 */
    private receiveObservation(message: Record<string, unknown>): void {
        const followed = this.observation;
        const params = ipcRecord(message.params);
        if (!followed || params?.conversationId !== followed.conversationId || params.hostId !== 'local') return;
        if (message.sourceClientId !== this.ownerClientId) { this.fail('owner_changed'); return; }
        if (message.version !== 11) { this.fail('incompatible_protocol'); return; }
        const change = ipcRecord(params.change);
        if (!change || !Number.isSafeInteger(change.revision) || Number(change.revision) < 0) { this.fail('invalid_snapshot'); return; }
        const first = followed.revision === null;
        const previous = readDesktopConversationObservation(followed.state, followed.conversationId);
        if (change.type === 'snapshot') {
            if (followed.revision !== null && Number(change.revision) <= followed.revision) return;
            followed.state = change.conversationState;
        } else if (change.type === 'patches') {
            if (followed.revision === null || change.baseRevision !== followed.revision || Number(change.revision) <= followed.revision) {
                this.fail('revision_gap'); return;
            }
            if (!Array.isArray(change.patches)) { this.fail('invalid_snapshot'); return; }
            const currentState = ipcRecord(followed.state);
            if (!currentState) { this.fail('invalid_snapshot'); return; }
            try { followed.state = applyPatches(currentState, change.patches as Patch[]); }
            catch { this.fail('invalid_snapshot'); return; }
        } else { this.fail('invalid_snapshot'); return; }
        followed.revision = Number(change.revision);
        this.controlSnapshotListener?.(followed.state);
        const next = readDesktopConversationObservation(followed.state, followed.conversationId);
        const continuity = change.type === 'patches' ? 'event' : 'snapshot';
        if (next.state === 'unknown') {
            followed.confirmed = false;
            followed.listener(next, continuity);
            return;
        }
        // 线程已开始活动而尾轮仍是旧终态时，等待明确新轮；反方向的 idle 也不能生成完成。
        if (['completed', 'failed', 'cancelled'].includes(next.state)
            && ipcRecord(ipcRecord(followed.state)?.threadRuntimeStatus)?.type === 'active') {
            if (first) followed.anchor = next;
            followed.confirmed = false;
            followed.listener({ v: 1, state: 'unknown', reason: 'not_observed' }, continuity);
            return;
        }
        const anchor = followed.anchor;
        const progressed = anchor && hasLifecycleProgress(anchor, next, followed.state);
        // 未确认的可解析帧也是下一次连续事件的基线；未知或尾岛切换不能让观察永久失去恢复入口。
        const recoveredByEvent = continuity === 'event' && previous.state !== 'unknown'
            && hasLifecycleProgress(previous, next, followed.state);
        // 空会话的新 turn 插入或无 ID 占位绑定可以确认；任意 metadata 补丁不能确认首快照。
        const boundPlaceholder = !anchor && continuity === 'event' && previous.state === 'unknown'
            && previous.reason === 'missing_turn_id' && Array.isArray(change.patches)
            && change.patches.some((patch) => {
                const value = ipcRecord(patch);
                const path = value?.path;
                if (!Array.isArray(path)) return false;
                const turnDepth = path[0] === 'turns' ? 2
                    : path[0] === 'turnHistory' && path[1] === 'history' && path[2] === 'entitiesByKey' ? 4 : -1;
                return (path.length === turnDepth + 1 && path.at(-1) === 'turnId' && value?.value === next.turnId)
                    || (path.length === turnDepth && value?.op === 'add' && ipcRecord(value.value)?.turnId === next.turnId);
            });
        const unchangedConfirmed = followed.confirmed && anchor && observationKey(anchor) === observationKey(next);
        if (!first && (progressed || recoveredByEvent || boundPlaceholder || unchangedConfirmed)) {
            followed.anchor = next;
            followed.confirmed = true;
            followed.listener(next, continuity);
        } else {
            if (first) followed.anchor = next;
            followed.confirmed = false;
            followed.listener({ v: 1, state: 'unknown', reason: 'not_observed' }, continuity);
        }
    }

    /** 发出带唯一 transport ID 的请求；只有匹配响应才能结束等待。 */
    async request(method: string, version: number, params: Record<string, unknown>,
        requestId: string = randomUUID(), targetClientId?: string): Promise<DesktopIpcResponse> {
        if (this.failure) throw this.failure;
        if (this.socket.destroyed || !this.socket.writable) throw new DesktopIpcError('connection_closed');
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new DesktopIpcError('timeout'));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(requestId, { resolve, reject, timer });
            try {
                // 本地请求必须省略顶层 hostId；否则 Desktop 使用另一方法版本。
                this.write({ type: 'request', requestId, sourceClientId: this.clientId, method, version,
                    params, ...(targetClientId ? { targetClientId } : {}), timeoutMs: REQUEST_TIMEOUT_MS });
            } catch {
                this.fail('connection_closed');
            }
        });
    }

    /** 编码 4 字节小端长度；成功写入绝不等价于 owner 接受。 */
    private write(message: unknown): void {
        const body = Buffer.from(JSON.stringify(message), 'utf8');
        if (body.length > MAX_FRAME_BYTES) throw new DesktopIpcError('invalid_request');
        const header = Buffer.alloc(4);
        header.writeUInt32LE(body.length);
        this.socket.write(Buffer.concat([header, body]));
    }

    /** 处理碎片帧与合并帧，非法帧关闭连接并保留未知发送结果。 */
    private readFrames(chunk: Buffer): void {
        this.bytes = Buffer.concat([this.bytes, chunk]);
        while (this.bytes.length >= 4 && !this.failure) {
            const size = this.bytes.readUInt32LE(0);
            if (size === 0 || size > MAX_FRAME_BYTES) { this.fail('invalid_response'); return; }
            if (this.bytes.length < size + 4) return;
            const body = this.bytes.subarray(4, size + 4);
            this.bytes = this.bytes.subarray(size + 4);
            try {
                const message = ipcRecord(JSON.parse(body.toString('utf8')));
                if (!message) { this.fail('invalid_response'); return; }
                this.handleMessage(message);
            } catch { this.fail('invalid_response'); }
        }
    }

    /** 拒绝 owner 发现邀请，仅接受匹配的响应和失联通知。 */
    private handleMessage(message: Record<string, unknown>): void {
        if (message.type === 'client-discovery-request' && ipcString(message.requestId)) {
            this.write({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
            return;
        }
        if (message.type === 'request' && ipcString(message.requestId)) {
            this.write({ type: 'response', requestId: message.requestId, resultType: 'error', error: 'no-handler-for-request' });
            return;
        }
        if (message.type === 'broadcast') {
            if (message.method === 'thread-stream-state-changed') this.receiveObservation(message);
            const params = ipcRecord(message.params);
            if (message.method === 'client-status-changed' && params?.status === 'disconnected' && ipcString(params.clientId)) {
                this.disconnectedClients.add(params.clientId);
            }
            if (message.method === 'ipc-connection-reset'
                || (message.method === 'client-status-changed' && params?.status === 'disconnected'
                    && params.clientId === this.ownerClientId)) this.fail('owner_changed');
            return;
        }
        if (message.type !== 'response' || !ipcString(message.requestId)) return;
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.requestId);
        pending.resolve(message);
    }

    /** 原子撤销全部未完成等待；不把掉线后的残留帧用于下一次调用。 */
    private fail(reason: string): void {
        if (this.failure) return;
        this.failure = new DesktopIpcError(reason);
        const followed = this.observation;
        this.observation = null;
        if (followed) {
            const safeReason: DirectSessionObservationUnknownReason = ['owner_changed', 'incompatible_protocol', 'revision_gap', 'invalid_snapshot'].includes(reason)
                ? reason as DirectSessionObservationUnknownReason : 'connection_closed';
            followed.listener({ v: 1, state: 'unknown', reason: safeReason }, 'snapshot');
        }
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(this.failure);
        }
        this.pending.clear();
        this.bytes = Buffer.alloc(0);
        this.socket.destroy();
    }

    /** 结束短连接，只销毁自己的 follower socket。 */
    close(): void { this.fail('connection_closed'); }
    /** 上层只据此重建 follower，不把未知快照误当成连接已断。 */
    isClosed(): boolean { return this.failure !== null; }
}
