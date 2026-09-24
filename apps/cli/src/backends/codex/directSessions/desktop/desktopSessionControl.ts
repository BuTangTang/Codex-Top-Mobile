import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { configuration } from '@/configuration';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';
import {
    createProtectedLocalStateFileExclusive,
    readProtectedLocalStateFile,
    writeProtectedLocalStateFileAtomic,
} from '@/utils/fs/protectedLocalState';

import { DesktopIpc, DesktopIpcError, assertDesktopPlatform, desktopResponseFailure, ipcRecord, ipcString } from './desktopIpc';
import type { DirectSessionControlActionRequest, DirectSessionControlResult, DesktopControlSnapshotV1 } from '@happier-dev/protocol';
import { readDesktopControlSnapshot, readNativeApprovalRequestId } from './desktopControlSnapshot';

/** 从固定原 owner 读取当前轮次和可审查的待决定详情。 */
export async function getDesktopSessionControlSnapshot(params: DesktopSessionTarget): Promise<DesktopControlSnapshotV1> {
    assertDesktopPlatform();
    const ipc = await DesktopIpc.open(await resolveHome(params.codexHome));
    try {
        await ipc.discoverOwner(params.remoteSessionId);
        return readDesktopControlSnapshot(await ipc.readControlSnapshot(params.remoteSessionId), params.remoteSessionId);
    } finally { ipc.close(); }
}

/** 重新读取同一 owner 的 steer 证明并绑定原轮次，仅投递一次纯文本，不降级为新轮。 */
async function steerDesktopSession(params: DesktopSessionTarget & { accountId: string; action: Extract<DirectSessionControlActionRequest, { kind: 'steer' }> }): Promise<DirectSessionControlResult> {
    let ipc: DesktopIpc | undefined;
    let dispatched = false;
    try {
        const home = await resolveHome(params.codexHome);
        const action = params.action;
        const key = digest(JSON.stringify(['steer', home, params.remoteSessionId, action.operationId]));
        const intentPath = join(receiptDirectory(params.accountId), `${key}.intent.json`);
        const payloadHash = digest(JSON.stringify([action.expectedTurnId, action.text]));
        try {
            const previous = ipcRecord(JSON.parse(await readProtectedLocalStateFile(intentPath)));
            if (previous?.version !== 1 || !ipcString(previous.payloadHash)) return { status: 'unknown', reason: 'delivery_outcome_unknown' };
            return { status: previous?.payloadHash === payloadHash ? 'unknown' : 'rejected',
                reason: previous?.payloadHash === payloadHash ? 'delivery_outcome_unknown' : 'local_id_conflict' };
        } catch (error) {
            if (ipcRecord(error)?.code !== 'ENOENT') return { status: 'unknown', reason: 'delivery_outcome_unknown' };
        }
        ipc = await DesktopIpc.open(home);
        const owner = await ipc.discoverOwner(params.remoteSessionId);
        const snapshot = readDesktopControlSnapshot(await ipc.readControlSnapshot(params.remoteSessionId), params.remoteSessionId);
        if (snapshot.turnId !== action.expectedTurnId) return { status: 'rejected', reason: 'turn_changed' };
        if (snapshot.state !== 'running') return { status: 'rejected', reason: 'turn_not_running' };
        if (snapshot.textSendMode !== 'steer') return { status: 'rejected', reason: 'text_send_unavailable' };
        if (!ipcString(snapshot.cwd)) return { status: 'rejected', reason: 'missing_working_directory' };
        try { await createProtectedLocalStateFileExclusive(intentPath, JSON.stringify({ version: 1, payloadHash })); }
        catch (error) {
            if (ipcRecord(error)?.code === 'EEXIST') return { status: 'unknown', reason: 'delivery_outcome_unknown' };
            throw error;
        }
        dispatched = true;
        const response = await ipc.request('thread-follower-steer-turn', 1, {
            conversationId: params.remoteSessionId, clientUserMessageId: action.operationId,
            input: [{ type: 'text', text: action.text, text_elements: [] }], attachments: [],
            restoreMessage: { id: action.operationId, text: action.text, cwd: snapshot.cwd, createdAt: Date.now(),
                context: { prompt: action.text, addedFiles: [], fileAttachments: [], ideContext: null,
                    imageAttachments: [], workspaceRoots: [snapshot.cwd] } },
        }, randomUUID(), owner);
        const result = ipcRecord(ipcRecord(response.result)?.result);
        if (response.resultType !== 'success' || response.method !== 'thread-follower-steer-turn'
            || response.handledByClientId !== owner || !ipcString(result?.turnId)) return { status: 'unknown', reason: 'delivery_outcome_unknown' };
        // 原 owner 内部可能因 turn 竞态改投新轮次；不能将不同 turn 的回执当原轮次成功。
        return result.turnId === action.expectedTurnId ? { status: 'accepted', turnId: result.turnId } : { status: 'unknown', reason: 'turn_changed' };
    } catch (error) {
        return { status: dispatched ? 'unknown' : 'rejected', reason: dispatched ? 'delivery_outcome_unknown' : reasonFor(error) };
    } finally { ipc?.close(); }
}

/** 精确审批只提交一次；ACK 或请求随后消失均不能证明本次决定胜出。 */
export async function performDesktopSessionControlAction(params: DesktopSessionTarget & { accountId: string; action: DirectSessionControlActionRequest }): Promise<DirectSessionControlResult> {
    let ipc: DesktopIpc | undefined;
    let dispatched = false;
    try {
        assertDesktopPlatform();
        const home = await resolveHome(params.codexHome);
        const action = params.action;
        if (action.kind === 'steer') return steerDesktopSession({ ...params, action });
        // 请求级锁不包含 operationId 或决定，晚到的相反决定也不能绕过重投保护。
        const key = digest(JSON.stringify(['approval', home, params.remoteSessionId, action.expectedTurnId, action.requestId]));
        const intentPath = join(receiptDirectory(params.accountId), `${key}.intent.json`);
        const payloadHash = digest(JSON.stringify([action.revision, action.decision]));
        try {
            const previous = ipcRecord(JSON.parse(await readProtectedLocalStateFile(intentPath)));
            if (previous?.version !== 1 || !ipcString(previous.payloadHash)) return { status: 'unknown', reason: 'approval_outcome_unknown' };
            return { status: previous?.payloadHash === payloadHash ? 'unknown' : 'rejected',
                reason: previous?.payloadHash === payloadHash ? 'approval_outcome_unknown' : 'request_decision_conflict' };
        } catch (error) {
            if (ipcRecord(error)?.code !== 'ENOENT') return { status: 'unknown', reason: 'approval_outcome_unknown' };
        }
        ipc = await DesktopIpc.open(home);
        const owner = await ipc.discoverOwner(params.remoteSessionId);
        const raw = await ipc.readControlSnapshot(params.remoteSessionId);
        const snapshot = readDesktopControlSnapshot(raw, params.remoteSessionId);
        if (snapshot.turnId !== action.expectedTurnId) return { status: 'rejected', reason: 'turn_changed' };
        if (snapshot.state !== 'running') return { status: 'rejected', reason: 'turn_not_running' };
        const request = snapshot.requests.find((request) => request.requestId === action.requestId);
        if (!request) return { status: 'rejected', reason: 'request_expired' };
        if (request.revision !== action.revision) return { status: 'rejected', reason: 'request_changed' };
        if (!request.canDecide || request.kind === 'unsupported') return { status: 'rejected', reason: 'unsupported_request' };
        const method = request.kind === 'command' ? 'thread-follower-command-approval-decision' : 'thread-follower-file-approval-decision';
        // operationId 同时绑定原请求；旧按钮 ID 不能被复用来决定另一条请求。
        const operationPath = join(receiptDirectory(params.accountId), `${digest(JSON.stringify(['approval-operation', home, params.remoteSessionId, action.operationId]))}.intent.json`);
        const operationHash = digest(JSON.stringify([action.expectedTurnId, action.requestId, action.revision, action.decision]));
        try { await createProtectedLocalStateFileExclusive(operationPath, JSON.stringify({ version: 1, payloadHash: operationHash })); }
        catch (error) {
            if (ipcRecord(error)?.code !== 'EEXIST') throw error;
            try {
                const previous = ipcRecord(JSON.parse(await readProtectedLocalStateFile(operationPath)));
                if (previous?.version === 1 && ipcString(previous.payloadHash) && previous.payloadHash !== operationHash) {
                    return { status: 'rejected', reason: 'local_id_conflict' };
                }
            } catch { /* 已存在但读不到的意图只能保持未知。 */ }
            return { status: 'unknown', reason: 'approval_outcome_unknown' };
        }
        try {
            await createProtectedLocalStateFileExclusive(intentPath, JSON.stringify({ version: 1, payloadHash }));
        } catch (error) {
            if (ipcRecord(error)?.code === 'EEXIST') return { status: 'unknown', reason: 'approval_outcome_unknown' };
            throw error;
        }
        dispatched = true;
        await ipc.request(method, 1, { conversationId: params.remoteSessionId,
            requestId: readNativeApprovalRequestId(raw, action.requestId), decision: action.decision === 'allow_once' ? 'accept' : 'decline' }, randomUUID(), owner);
        // 主程序可能已在审批竞态中移除该请求；同 owner 回读只反映当前状态。
        try { await ipc.readControlSnapshot(params.remoteSessionId); } catch { /* 失联保持未知，不发第二次决定。 */ }
        return { status: 'unknown', reason: 'approval_outcome_unknown' };
    } catch (error) {
        return { status: dispatched ? 'unknown' : 'rejected', reason: dispatched ? 'approval_outcome_unknown' : reasonFor(error) };
    } finally { ipc?.close(); }
}

export type DesktopSessionControl =
    | Readonly<{ available: true; ownerClientId: string; protocolVersion: 2 }>
    | Readonly<{ available: false; reason: string }>;

type SendIdentity = Readonly<{ localId: string; remoteSessionId: string; deduplicated: boolean }>;
export type DesktopSessionSendResult = SendIdentity & (
    | Readonly<{ status: 'accepted'; ownerClientId: string; requestId: string; turnId: string; receiptPersisted: boolean }>
    | Readonly<{ status: 'rejected' | 'unknown'; reason: string; ownerClientId?: string; requestId?: string }>
);

export type DesktopSessionTarget = Readonly<{ codexHome: string; remoteSessionId: string }>;
export type DesktopSessionMessage = DesktopSessionTarget & Readonly<{ text: string; localId: string; accountId: string }>;

/** 只规范本机路径，不创建或修改 Codex 的任何文件。 */
async function resolveHome(codexHome: string): Promise<string> {
    if (!ipcString(codexHome)) throw new DesktopIpcError('invalid_request');
    const expanded = expandHomeDirPath(codexHome);
    if (!isAbsolute(expanded)) throw new DesktopIpcError('invalid_request');
    try { return await realpath(expanded); }
    catch { throw new DesktopIpcError('router_unavailable'); }
}

/** 将所有未知异常收敛为稳定原因，避免传出正文、凭据或完整本机路径。 */
function reasonFor(error: unknown): string {
    return error instanceof DesktopIpcError ? error.reason : 'receipt_unavailable';
}

/** 查询当前 Desktop 的既有 owner；此结果不承诺稍后的发送仍可接受。 */
export async function getDesktopSessionControl(params: DesktopSessionTarget): Promise<DesktopSessionControl> {
    let ipc: DesktopIpc | undefined;
    try {
        assertDesktopPlatform();
        if (!ipcString(params.remoteSessionId)) throw new DesktopIpcError('invalid_request');
        ipc = await DesktopIpc.open(await resolveHome(params.codexHome));
        const ownerClientId = await ipc.discoverOwner(params.remoteSessionId);
        return { available: true, ownerClientId, protocolVersion: 2 };
    } catch (error) {
        return { available: false, reason: reasonFor(error) };
    } finally { ipc?.close(); }
}

/** 摘要只用于私有意图定位和冲突比较，不保存用户正文或 Codex 路径。 */
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

/** 账号由调用方既有认证边界固定；不在异步投递期间再次读取可变凭据。 */
function receiptDirectory(accountId: string): string {
    if (!ipcString(accountId)) throw new DesktopIpcError('authentication_unavailable');
    return join(configuration.activeServerDir, 'desktop-session-delivery', digest(accountId));
}

/** 仅重放结构完整且属于本次身份/请求的持久化结果。 */
function parseReceipt(value: unknown, identity: SendIdentity, requestId: string): DesktopSessionSendResult | null {
    const receipt = ipcRecord(value);
    if (!receipt || receipt.localId !== identity.localId || receipt.remoteSessionId !== identity.remoteSessionId
        || receipt.requestId !== requestId) return null;
    if (receipt.status === 'accepted' && ipcString(receipt.ownerClientId) && ipcString(receipt.turnId)) {
        return { ...identity, status: 'accepted', ownerClientId: receipt.ownerClientId, requestId,
            turnId: receipt.turnId, receiptPersisted: true };
    }
    if ((receipt.status === 'rejected' || receipt.status === 'unknown') && ipcString(receipt.reason)) {
        return { ...identity, status: receipt.status, reason: receipt.reason, requestId,
            ...(ipcString(receipt.ownerClientId) ? { ownerClientId: receipt.ownerClientId } : {}) };
    }
    return null;
}

/** 已有意图一律不重投；崩溃、并发、损坏结果均保留为未知，绝不承诺 exactly-once。 */
async function replayIntent(intentPath: string, receiptPath: string, payloadHash: string,
    identity: SendIdentity): Promise<DesktopSessionSendResult> {
    const duplicate = { ...identity, deduplicated: true };
    let requestId: string | undefined;
    try {
        const intent = ipcRecord(JSON.parse(await readProtectedLocalStateFile(intentPath)));
        if (intent?.version !== 1 || !ipcString(intent.payloadHash) || !ipcString(intent.requestId)) {
            return { ...duplicate, status: 'unknown', reason: 'delivery_outcome_unknown' };
        }
        requestId = intent.requestId;
        if (intent.payloadHash !== payloadHash) return { ...duplicate, status: 'rejected', reason: 'local_id_conflict' };
        const receipt = parseReceipt(JSON.parse(await readProtectedLocalStateFile(receiptPath)), duplicate, requestId);
        if (receipt) return receipt;
    } catch {
        // 不能把缺失、仍在写入或不可读的结果误判为“从未发送”。
    }
    return { ...duplicate, status: 'unknown', reason: 'delivery_outcome_unknown', ...(requestId ? { requestId } : {}) };
}

/** 在固定 owner 上复核 start 证明后提交一次；只有匹配成功应答和 turn ID 才算接受。 */
async function submitOnce(codexHome: string, message: DesktopSessionMessage, requestId: string,
    identity: SendIdentity): Promise<DesktopSessionSendResult> {
    let ipc: DesktopIpc | undefined;
    let ownerClientId: string | undefined;
    let dispatched = false;
    try {
        ipc = await DesktopIpc.open(codexHome);
        ownerClientId = await ipc.discoverOwner(message.remoteSessionId);
        // 手机读取后的闲忙变化必须由真正投递者复核；不把 busy 自动改投 steer。
        const snapshot = readDesktopControlSnapshot(await ipc.readControlSnapshot(message.remoteSessionId), message.remoteSessionId);
        if (snapshot.textSendMode !== 'start') throw new DesktopIpcError('turn_not_idle');
        dispatched = true;
        const response = await ipc.request('thread-follower-start-turn', 2, {
            conversationId: message.remoteSessionId,
            turnStart: {
                request: { threadId: message.remoteSessionId, clientUserMessageId: message.localId,
                    input: [{ type: 'text', text: message.text, text_elements: [] }] },
                context: { inheritThreadSettings: true },
            },
        }, requestId, ownerClientId);
        if (response.resultType === 'error') {
            const reason = desktopResponseFailure(response);
            return { ...identity, status: reason === 'owner_unavailable' || reason === 'incompatible_protocol' ? 'rejected' : 'unknown',
                reason, ownerClientId, requestId };
        }
        const turn = ipcRecord(ipcRecord(ipcRecord(response.result)?.result)?.turn);
        if (response.resultType !== 'success' || response.method !== 'thread-follower-start-turn'
            || response.handledByClientId !== ownerClientId || !ipcString(turn?.id)) {
            // 忙时排队/其他未验证形状不能假装拒绝，更不能换 localId 自动重试。
            return { ...identity, status: 'unknown', reason: 'invalid_response', ownerClientId, requestId };
        }
        return { ...identity, status: 'accepted', ownerClientId, requestId, turnId: turn.id, receiptPersisted: false };
    } catch (error) {
        return { ...identity, status: dispatched ? 'unknown' : 'rejected', reason: reasonFor(error), requestId,
            ...(ownerClientId ? { ownerClientId } : {}) };
    } finally { ipc?.close(); }
}

/**
 * 先持久化独占意图，再向原 Desktop owner 提交。相同 localId 的重复/冲突不再发送。
 * 意图落盘后崩溃会牺牲自动重试，保留 unknown；不能证明跨重启 exactly-once。
 * 普通发送路径不创建 router、app-server 或会话，也不使用 resume/steer/进程控制回退。
 */
export async function sendDesktopSessionUserMessage(params: DesktopSessionMessage): Promise<DesktopSessionSendResult> {
    const identity: SendIdentity = { localId: params.localId, remoteSessionId: params.remoteSessionId, deduplicated: false };
    if (!ipcString(params.localId) || !ipcString(params.remoteSessionId) || !ipcString(params.text)) {
        return { ...identity, status: 'rejected', reason: 'invalid_request' };
    }
    try {
        assertDesktopPlatform();
        const codexHome = await resolveHome(params.codexHome);
        const directory = receiptDirectory(params.accountId);
        const key = digest(JSON.stringify([codexHome, params.remoteSessionId, params.localId]));
        const intentPath = join(directory, `${key}.intent.json`);
        const receiptPath = join(directory, `${key}.receipt.json`);
        const payloadHash = digest(params.text);
        const requestId = randomUUID();
        try {
            // 跨进程由既有 O_EXCL + fsync 工具保证只有一个提交者，不依赖内存 map。
            await createProtectedLocalStateFileExclusive(intentPath, JSON.stringify({ version: 1, payloadHash, requestId }));
        } catch (error) {
            if (ipcRecord(error)?.code === 'EEXIST') return replayIntent(intentPath, receiptPath, payloadHash, identity);
            throw error;
        }
        const result = await submitOnce(codexHome, params, requestId, identity);
        try {
            const persisted = result.status === 'accepted' ? { ...result, receiptPersisted: true } : result;
            await writeProtectedLocalStateFileAtomic(receiptPath, JSON.stringify(persisted));
            return persisted;
        } catch {
            // 接受证据仍有效，明确标注落盘失败；不可删除意图来“恢复”发送。
            return result;
        }
    } catch (error) {
        return { ...identity, status: 'rejected', reason: reasonFor(error) };
    }
}
