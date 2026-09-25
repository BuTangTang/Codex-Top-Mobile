import { isDeepStrictEqual } from 'node:util';
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
// 完整历史的关联回执已在 26.917.62051 (10789) 核对；同一来源可能并存独立 revision 流。
// 方法版本/帧上限/超时来自该客户端；版本匹配不代表运行构建已认证。
// 同类协议参考：Emanuele-web04/remodex@e0e342dac5cddd40db661bfcf76e5ab0e3913ef8。
// 这里独立实现协议边界，没有复制 Remodex 实现。
const REQUEST_TIMEOUT_MS = 5_000;
// 真实长会话的关联回执在 9.4 秒到达；仅本地只读水合等待 15 秒，线上请求仍为 5 秒。
const CONTROL_READ_TIMEOUT_MS = 15_000;
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
    private readonly frameHeader: Buffer = Buffer.alloc(4);
    private frameHeaderBytes = 0;
    private frameBody: Buffer | null = null;
    private frameBodyBytes = 0;
    private failure: DesktopIpcError | null = null;
    private ownerClientId: string | null = null;
    private observation: { conversationId: string; listener: (observation: DirectSessionObservationV1, continuity: 'snapshot' | 'event') => void;
        revision: number | null; state: unknown; anchor: KnownObservation | null; confirmed: boolean } | null = null;
    private snapshotAnchor: { subscription: NonNullable<DesktopIpc['observation']>; frames: Record<string, unknown>[];
        bytes: number; revision: number | null; discardedRevisions: Set<number>; timer: ReturnType<typeof setTimeout> } | null = null;
    private readonly disconnectedClients = new Set<string>();
    private controlSnapshotAnchored = false;
    private controlSnapshotReject: ((error: Error) => void) | null = null;
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
            this.clearSnapshotAnchor();
            this.observation = null;
            if (!this.failure) this.write({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1,
                sourceClientId: this.clientId, targetClientIds: [this.ownerClientId],
                params: { hostId: 'local', conversationId, following: false } });
        };
    }

    /**
     * 只读证明独立基线轮之后的当前尾轮：连接与订阅必须仍有效，且 next 必须精确匹配已确认的当前投影。
     * 复用同一连续尾岛的顺序规则；陌生 scope、缺失基线或同轮状态变化均不构成换轮证明。
     * 可在 follow 回调内同步调用，不发送请求、不水合历史，也不提升任何未确认快照的可信度。
     */
    confirmsFollowingTurn(conversationId: string, previousTurnId: string, next: KnownObservation): boolean {
        const followed = this.observation;
        if (this.failure || this.socket.destroyed || !this.socket.writable || !followed?.confirmed
            || followed.conversationId !== conversationId || previousTurnId === next.turnId) return false;
        const current = readDesktopConversationObservation(followed.state, conversationId);
        if (current.state === 'unknown' || observationKey(current) !== observationKey(next)) return false;
        return followsObservedTurn(followed.state, previousTurnId, next.turnId);
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
                timer = setTimeout(() => reject(new DesktopIpcError('timeout')), CONTROL_READ_TIMEOUT_MS);
                this.controlSnapshotReject = reject;
                this.controlSnapshotListener = () => {
                    if (this.controlSnapshotAnchored && !this.snapshotAnchor) resolve();
                };
                stop = this.followConversation(conversationId, () => {});
                this.beginSnapshotAnchor();
            });
            const subscribed = this.observation;
            await ready;
            // 同一 data 批可先给快照、再给补丁或断线；只读取原订阅最新状态，不捕获首帧对象。
            if (this.failure) throw this.failure;
            if (!this.controlSnapshotAnchored || this.snapshotAnchor || !subscribed || this.observation !== subscribed || subscribed.conversationId !== conversationId
                || !ipcRecord(subscribed.state)) throw new DesktopIpcError('invalid_snapshot');
            return subscribed.state;
        } finally {
            if (timer) clearTimeout(timer);
            this.controlSnapshotListener = null;
            this.controlSnapshotReject = null;
            this.controlSnapshotAnchored = false;
            stop?.();
        }
    }

    /** 清理当前订阅的关联等待；过期响应不能恢复已释放或更换的订阅。 */
    private clearSnapshotAnchor(): void {
        if (this.snapshotAnchor) clearTimeout(this.snapshotAnchor.timer);
        this.snapshotAnchor = null;
    }

    /** 请求固定 owner 返回历史水合 revision；不把首包、最大编号或现存终态视为新事实。 */
    private beginSnapshotAnchor(): void {
        const subscription = this.observation;
        if (!subscription || this.snapshotAnchor || !this.ownerClientId) return;
        const anchor = { subscription, frames: [] as Record<string, unknown>[], bytes: 0, revision: null as number | null,
            discardedRevisions: new Set<number>(), timer: setTimeout(() => this.fail('timeout'), CONTROL_READ_TIMEOUT_MS) };
        this.snapshotAnchor = anchor;
        void this.request('thread-follower-load-complete-history', 1, { conversationId: subscription.conversationId },
            randomUUID(), this.ownerClientId).then((response) => {
            if (this.snapshotAnchor !== anchor || this.observation !== subscription || this.failure) return;
            if (response.resultType === 'error') { this.fail(desktopResponseFailure(response)); return; }
            const result = ipcRecord(response.result);
            if (response.resultType !== 'success' || response.method !== 'thread-follower-load-complete-history'
                || response.handledByClientId !== this.ownerClientId || !Number.isSafeInteger(result?.revision)
                || Number(result?.revision) < 0) { this.fail('invalid_response'); return; }
            anchor.revision = Number(result!.revision);
            if (anchor.discardedRevisions.has(anchor.revision)) { this.fail('revision_gap'); return; }
            this.finishSnapshotAnchor();
        }).catch((error) => {
            if (this.snapshotAnchor === anchor) this.fail(error instanceof DesktopIpcError ? error.reason : 'connection_closed');
        });
    }

    /** 从候选快照沿精确 baseRevision 重建回执指定状态；同编号的不同结果一律拒绝。 */
    private finishSnapshotAnchor(): void {
        const anchor = this.snapshotAnchor;
        if (!anchor || anchor.revision === null) return;
        const candidates = new Map<number, { state: Record<string, unknown>; index: number }>();
        const equivalentAnchorFrames = new Set<number>();
        for (let index = 0; index < anchor.frames.length; index++) {
            const change = ipcRecord(ipcRecord(anchor.frames[index]!.params)?.change)!;
            const revision = Number(change.revision);
            if (revision > anchor.revision) continue;
            let state: Record<string, unknown> | null;
            if (change.type === 'snapshot') {
                state = ipcRecord(change.conversationState);
                if (!state) { this.fail('invalid_snapshot'); return; }
            } else {
                const base = candidates.get(Number(change.baseRevision));
                if (!base) continue; // 不跨过缺失基线，也不拼接别的修订流。
                if (!Number.isSafeInteger(change.baseRevision) || revision <= Number(change.baseRevision)) {
                    this.fail('revision_gap'); return;
                }
                if (!Array.isArray(change.patches)) { this.fail('invalid_snapshot'); return; }
                try { state = ipcRecord(applyPatches(base.state, change.patches as Patch[])); }
                catch { this.fail('invalid_snapshot'); return; }
                if (!state) { this.fail('invalid_snapshot'); return; }
            }
            const existing = candidates.get(revision);
            if (existing && !isDeepStrictEqual(existing.state, state)) { this.fail('invalid_snapshot'); return; }
            if (!existing) candidates.set(revision, { state, index });
            if (revision === anchor.revision) equivalentAnchorFrames.add(index);
        }
        const selected = candidates.get(anchor.revision);
        if (!selected) return; // 响应可能先到，仍受同一次请求的期限约束。
        // 以已关联的重建结果建立一次基线，不将历史水合补丁伪装为实时生命周期事件。
        const baseline = { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
            sourceClientId: this.ownerClientId, params: { hostId: 'local', conversationId: anchor.subscription.conversationId,
                change: { type: 'snapshot', revision: anchor.revision, conversationState: selected.state } } };
        // 同一回执状态的等价重建帧已验证；其余尾帧仍须逐一检查，不能吞掉新快照或缺口。
        const frames = anchor.frames.filter((_, index) => index > selected.index && !equivalentAnchorFrames.has(index));
        this.clearSnapshotAnchor();
        anchor.subscription.revision = null;
        anchor.subscription.state = null;
        anchor.subscription.anchor = null;
        anchor.subscription.confirmed = false;
        this.controlSnapshotAnchored = false;
        this.applyObservation(baseline);
        for (const frame of frames) {
            if (this.failure || this.observation !== anchor.subscription) break;
            this.receiveObservation(frame);
        }
        // 完整消化同批尾帧后才发布控制证明，避免首帧先唤醒再遇冲突。
        if (!this.failure && this.observation === anchor.subscription) {
            this.controlSnapshotAnchored = true;
            this.controlSnapshotListener?.(anchor.subscription.state);
        }
    }

    /** 仅控制读取关联快照；长订阅保留原行为，控制遇未关联完整快照即拒绝且不重请求。 */
    private receiveObservation(message: Record<string, unknown>, encodedBodyBytes?: number): void {
        const followed = this.observation;
        const params = ipcRecord(message.params);
        if (!followed || params?.conversationId !== followed.conversationId || params.hostId !== 'local') return;
        if (message.sourceClientId !== this.ownerClientId) { this.fail('owner_changed'); return; }
        if (message.version !== 11) { this.fail('incompatible_protocol'); return; }
        const change = ipcRecord(params.change);
        if (!change || !Number.isSafeInteger(change.revision) || Number(change.revision) < 0) { this.fail('invalid_snapshot'); return; }
        if (!this.snapshotAnchor && this.controlSnapshotListener && change.type === 'snapshot') {
            if (change.revision !== followed.revision || !isDeepStrictEqual(change.conversationState, followed.state)) {
                this.controlSnapshotAnchored = false;
                this.fail('invalid_snapshot');
            }
            return;
        }
        const anchor = this.snapshotAnchor;
        if (!anchor) { this.applyObservation(message); return; }
        if (anchor.discardedRevisions.has(Number(change.revision))) { this.fail('invalid_snapshot'); return; }
        if (change.type !== 'snapshot' && change.type !== 'patches') { this.fail('invalid_snapshot'); return; }
        // 保持原候选字节上限；只有完整快照可以替换窗口，补丁不能独立成为基线。
        // 真实接收沿用帧体原始字节数，避免为了计量再次序列化整份历史。
        const frameBytes = encodedBodyBytes ?? Buffer.byteLength(JSON.stringify(message));
        if (frameBytes > MAX_FRAME_BYTES) { this.fail('invalid_snapshot'); return; }
        if (anchor.bytes + frameBytes > MAX_FRAME_BYTES) {
            if (change.type !== 'snapshot') { this.fail('invalid_snapshot'); return; }
            for (const frame of anchor.frames) {
                const previous = ipcRecord(ipcRecord(frame.params)?.change);
                anchor.discardedRevisions.add(Number(previous?.revision));
            }
            // 不再持有旧正文时无法证明同号内容相等，因此保守拒绝跨窗口同号重发。
            if (anchor.discardedRevisions.has(Number(change.revision))) { this.fail('invalid_snapshot'); return; }
            anchor.frames = [];
            anchor.bytes = 0;
            if (anchor.revision !== null && anchor.discardedRevisions.has(anchor.revision)) { this.fail('revision_gap'); return; }
        }
        anchor.bytes += frameBytes;
        if (change.type === 'snapshot') {
            for (const frame of anchor.frames) {
                const previous = ipcRecord(ipcRecord(frame.params)?.change);
                if (previous?.type === 'snapshot' && previous.revision === change.revision
                    && !isDeepStrictEqual(previous.conversationState, change.conversationState)) {
                    this.fail('invalid_snapshot'); return;
                }
            }
        }
        anchor.frames.push(message);
        this.finishSnapshotAnchor();
    }

    /** 校验来源、版本、目标与连续 revision 后才应用补丁。缺口关闭当前代次，等待上层重新发现。 */
    private applyObservation(message: Record<string, unknown>): void {
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
            }, method === 'thread-follower-load-complete-history' ? CONTROL_READ_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
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

    /** 帧头跨片累积，正文只分配一次并顺序写入；避免大帧每片重新复制已有正文。 */
    private readFrames(chunk: Buffer): void {
        let offset = 0;
        while (offset < chunk.length && !this.failure) {
            if (!this.frameBody) {
                const headerBytes = Math.min(4 - this.frameHeaderBytes, chunk.length - offset);
                chunk.copy(this.frameHeader, this.frameHeaderBytes, offset, offset + headerBytes);
                this.frameHeaderBytes += headerBytes;
                offset += headerBytes;
                if (this.frameHeaderBytes < 4) return;
                const size = this.frameHeader.readUInt32LE(0);
                if (size === 0 || size > MAX_FRAME_BYTES) { this.fail('invalid_response'); return; }
                this.frameHeaderBytes = 0;
                this.frameBody = Buffer.allocUnsafe(size);
            }
            const bodyBytes = Math.min(this.frameBody.length - this.frameBodyBytes, chunk.length - offset);
            chunk.copy(this.frameBody, this.frameBodyBytes, offset, offset + bodyBytes);
            this.frameBodyBytes += bodyBytes;
            offset += bodyBytes;
            if (this.frameBodyBytes < this.frameBody.length) return;
            const body = this.frameBody;
            this.frameBody = null;
            this.frameBodyBytes = 0;
            try {
                const message = ipcRecord(JSON.parse(body.toString('utf8')));
                if (!message) { this.fail('invalid_response'); return; }
                this.handleMessage(message, body.length);
            } catch { this.fail('invalid_response'); }
        }
    }

    /** 拒绝 owner 发现邀请，仅接受匹配的响应和失联通知。 */
    private handleMessage(message: Record<string, unknown>, encodedBodyBytes?: number): void {
        if (message.type === 'client-discovery-request' && ipcString(message.requestId)) {
            this.write({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
            return;
        }
        if (message.type === 'request' && ipcString(message.requestId)) {
            this.write({ type: 'response', requestId: message.requestId, resultType: 'error', error: 'no-handler-for-request' });
            return;
        }
        if (message.type === 'broadcast') {
            if (message.method === 'thread-stream-state-changed') this.receiveObservation(message, encodedBodyBytes);
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
        this.controlSnapshotAnchored = false;
        this.clearSnapshotAnchor();
        this.controlSnapshotReject?.(this.failure);
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
        this.frameHeaderBytes = 0;
        this.frameBody = null;
        this.frameBodyBytes = 0;
        this.socket.destroy();
    }

    /** 结束短连接，只销毁自己的 follower socket。 */
    close(): void { this.fail('connection_closed'); }
    /** 上层只据此重建 follower，不把未知快照误当成连接已断。 */
    isClosed(): boolean { return this.failure !== null; }
}
