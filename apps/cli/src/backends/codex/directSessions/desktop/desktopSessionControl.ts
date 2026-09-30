import { createHash, randomUUID } from 'node:crypto';
import { realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { configuration } from '@/configuration';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';
import {
    createProtectedLocalStateFileExclusive,
    readProtectedLocalStateFile,
    removeProtectedLocalStateFile,
    writeProtectedLocalStateFileAtomic,
} from '@/utils/fs/protectedLocalState';

import { DesktopIpc, DesktopIpcError, assertDesktopPlatform, desktopResponseFailure, ipcRecord, ipcString } from './desktopIpc';
import type { DirectSessionControlActionRequest, DirectSessionControlResult, DesktopControlSnapshotV1, DesktopQuestionRequestV1, DirectSessionUploadedAttachmentV1 } from '@happier-dev/protocol';
import { readDesktopControlSnapshot, readNativeApprovalRequestId } from './desktopControlSnapshot';
import { prepareDesktopAttachmentMessage } from './desktopAttachments';
import { readDesktopAsyncQuestionReplies, readDesktopCurrentTurn } from './desktopQuestions';

/** 从固定原 owner 读取当前轮次和可审查的待决定详情。 */
export async function getDesktopSessionControlSnapshot(params: DesktopSessionTarget & { includeQuestions?: boolean }): Promise<DesktopControlSnapshotV1> {
    assertDesktopPlatform();
    const control = await acquireDesktopControl(params);
    try {
        return readDesktopControlSnapshot(control.read(), params.remoteSessionId, params.includeQuestions);
    } finally { control.close(); }
}

/** 重新读取同一 owner 的 steer 证明并绑定原轮次，仅投递一次纯文本，不降级为新轮。 */
async function steerDesktopSession(params: DesktopSessionTarget & { accountId: string; action: Extract<DirectSessionControlActionRequest, { kind: 'steer' }> }): Promise<DirectSessionControlResult> {
    let control: Awaited<ReturnType<typeof acquireDesktopControl>> | undefined;
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
        control = await acquireDesktopControl({ ...params, codexHome: home });
        const owner = control.ownerClientId;
        let snapshot = readDesktopControlSnapshot(control.read(), params.remoteSessionId);
        if (snapshot.turnId !== action.expectedTurnId) return { status: 'rejected', reason: 'turn_changed' };
        if (snapshot.state !== 'running') return { status: 'rejected', reason: 'turn_not_running' };
        if (snapshot.textSendMode !== 'steer') return { status: 'rejected', reason: 'text_send_unavailable' };
        if (!ipcString(snapshot.cwd)) return { status: 'rejected', reason: 'missing_working_directory' };
        try { await createProtectedLocalStateFileExclusive(intentPath, JSON.stringify({ version: 1, payloadHash })); }
        catch (error) {
            if (ipcRecord(error)?.code === 'EEXIST') return { status: 'unknown', reason: 'delivery_outcome_unknown' };
            throw error;
        }
        // 意图落盘期间连续订阅可能已换轮或失效；紧贴 request 再判一次，不跨 await 借旧状态。
        snapshot = readDesktopControlSnapshot(control.read(), params.remoteSessionId);
        if (snapshot.turnId !== action.expectedTurnId) return { status: 'rejected', reason: 'turn_changed' };
        if (snapshot.state !== 'running') return { status: 'rejected', reason: 'turn_not_running' };
        if (snapshot.textSendMode !== 'steer') return { status: 'rejected', reason: 'text_send_unavailable' };
        if (!ipcString(snapshot.cwd)) return { status: 'rejected', reason: 'missing_working_directory' };
        dispatched = true;
        const response = await control.ipc.request('thread-follower-steer-turn', 1, {
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
    } finally { control?.close(); }
}

type AnswerAction = Extract<DirectSessionControlActionRequest, { kind: 'answer' }>;

/** 每题单选或原题允许的自填必须完整提交；保留原题顺序和原选项文字。 */
function questionAnswers(request: DesktopQuestionRequestV1, action: AnswerAction): Record<string, string[]> {
    if (Object.keys(action.answers).length !== request.questions.length) throw new DesktopIpcError('invalid_answers');
    const entries = request.questions.map((question): [string, string[]] => {
        const answer = Object.hasOwn(action.answers, question.id) ? action.answers[question.id] : undefined;
        if (!answer || answer.length !== 1 || !ipcString(answer[0])
            || question.options.length > 0 && !question.isOther && !question.options.some((option) => option.label === answer[0]))
            throw new DesktopIpcError('invalid_answers');
        // 桌面可能已逐题回答；同卡剩余题仍可提交，但不能改写已接受的答案。
        if (request.answers?.[question.id] && JSON.stringify(request.answers[question.id]) !== JSON.stringify(answer))
            throw new DesktopIpcError('request_changed');
        return [question.id, [...answer]];
    });
    return Object.fromEntries(entries);
}

/** 提交前从连续原 owner 投影中重新校验轮次、请求类型、题目修订与未答状态。 */
function pendingQuestion(raw: unknown, conversationId: string, action: AnswerAction): DesktopQuestionRequestV1 {
    const snapshot = readDesktopControlSnapshot(raw, conversationId, true);
    if (snapshot.turnId !== action.expectedTurnId) throw new DesktopIpcError('turn_changed');
    if (snapshot.state !== 'running') throw new DesktopIpcError('turn_not_running');
    const question = snapshot.questions?.find((request) => request.kind === action.requestKind && request.requestId === action.requestId && request.itemId === action.itemId);
    if (!question || question.status !== 'pending') throw new DesktopIpcError('request_expired');
    if (question.revision !== action.revision) throw new DesktopIpcError('request_changed');
    if (!question.canAnswer) throw new DesktopIpcError('unsupported_request');
    return question;
}

/** 回答只沿原生提问动作提交一次；ACK、桌面记录与异步接受分别表达，未知结果不重投。 */
async function answerDesktopQuestions(params: DesktopSessionTarget & { accountId: string; action: AnswerAction }): Promise<DirectSessionControlResult> {
    let control: Awaited<ReturnType<typeof acquireDesktopControl>> | undefined;
    let dispatched = false;
    const createdIntents: string[] = [];
    try {
        const home = await resolveHome(params.codexHome), action = params.action;
        const identity = [home, params.remoteSessionId, action.expectedTurnId, action.requestKind, action.requestId, action.itemId, action.revision];
        const intentPath = join(receiptDirectory(params.accountId), `${digest(JSON.stringify(['answer', ...identity]))}.intent.json`);
        // 同一题即使换 operationId 也不能绕过未明结果；仅保存摘要，不落盘用户答案。
        try {
            await readProtectedLocalStateFile(intentPath);
            return { status: 'unknown', reason: 'answer_outcome_unknown' };
        } catch (error) { if (ipcRecord(error)?.code !== 'ENOENT') return { status: 'unknown', reason: 'answer_outcome_unknown' }; }
        control = await acquireDesktopControl({ ...params, codexHome: home }, true);
        let request = pendingQuestion(control.read(), params.remoteSessionId, action);
        const answers = questionAnswers(request, action);
        const payloadHash = digest(JSON.stringify([...identity, answers]));
        const operationPath = join(receiptDirectory(params.accountId), `${digest(JSON.stringify(['answer-operation', home, params.remoteSessionId, action.operationId]))}.intent.json`);
        try {
            await createProtectedLocalStateFileExclusive(operationPath, JSON.stringify({ version: 1, payloadHash }));
            createdIntents.push(operationPath);
        }
        catch (error) {
            if (ipcRecord(error)?.code !== 'EEXIST') throw error;
            const previous = ipcRecord(JSON.parse(await readProtectedLocalStateFile(operationPath)));
            return previous?.payloadHash !== payloadHash ? { status: 'rejected', reason: 'local_id_conflict' }
                : { status: 'unknown', reason: 'answer_outcome_unknown' };
        }
        try {
            await createProtectedLocalStateFileExclusive(intentPath, JSON.stringify({ version: 1, payloadHash }));
            createdIntents.push(intentPath);
        }
        catch (error) {
            if (ipcRecord(error)?.code !== 'EEXIST') throw error;
            return { status: 'unknown', reason: 'answer_outcome_unknown' };
        }
        // 落盘 await 期间桌面可抢先回答或换轮；发送前再次读取原连续订阅。
        request = pendingQuestion(control.read(), params.remoteSessionId, action);
        questionAnswers(request, action);
        const owner = control.ownerClientId;
        let method: string, nativeParams: Record<string, unknown>;
        if (request.kind === 'user_input') {
            method = 'thread-follower-submit-user-input';
            nativeParams = { conversationId: params.remoteSessionId, requestId: request.requestId,
                response: { answers: Object.fromEntries(Object.entries(answers).map(([id, values]) => [id, { answers: values }])) } };
        } else {
            method = 'thread-follower-steer-turn';
            const replies = request.questions.filter((question) => !request.answers?.[question.id]).map((question) => ({
                questionItemId: question.id, question: question.question, answer: answers[question.id]![0]!,
            }));
            const text = `<send_user_message_question_reply>\n${JSON.stringify(replies)}\n</send_user_message_question_reply>`;
            const cwd = ipcRecord(control.read())?.cwd;
            nativeParams = { conversationId: params.remoteSessionId, clientUserMessageId: action.operationId,
                input: [{ type: 'text', text, text_elements: [] }], attachments: [],
                restoreMessage: { id: action.operationId, text, createdAt: Date.now(), ...(ipcString(cwd) ? { cwd } : {}),
                    context: { prompt: text, addedFiles: [], fileAttachments: [], ideContext: null, imageAttachments: [],
                        ...(ipcString(cwd) ? { workspaceRoots: [cwd] } : {}), turnTrigger: 'send_user_message_async_question' } } };
        }
        dispatched = true;
        const response = await control.ipc.request(method, 1, nativeParams, randomUUID(), owner);
        if (response.resultType !== 'success' || response.method !== method || response.handledByClientId !== owner)
            return { status: 'unknown', reason: 'answer_outcome_unknown' };
        const raw = control.read();
        const snapshot = readDesktopControlSnapshot(raw, params.remoteSessionId, true);
        if (snapshot.turnId !== action.expectedTurnId) return { status: 'unknown', reason: 'answer_outcome_unknown' };
        if (request.kind === 'user_input') {
            // 已答计划题删除原请求后不保留原 itemId，因此按同类型 requestId 与 turnId 核对。
            const recorded = snapshot.questions?.find((item) => item.kind === 'user_input' && item.requestId === request.requestId && item.turnId === request.turnId);
            if (recorded?.status === 'answered'
                && JSON.stringify(recorded.questions.map(({ isOther, isSecret, ...question }) => question)) === JSON.stringify(request.questions.map(({ isOther, isSecret, ...question }) => question))
                && request.questions.every((question) => JSON.stringify(recorded.answers?.[question.id]) === JSON.stringify(answers[question.id])))
                return { status: 'recorded', turnId: request.turnId };
        } else {
            const result = ipcRecord(ipcRecord(response.result)?.result);
            const turn = readDesktopCurrentTurn(ipcRecord(raw)!);
            const item = Array.isArray(turn?.items) ? turn.items.map(ipcRecord).find((item) => item?.type === 'steeringUserMessage'
                && (item.id === action.operationId || item.clientUserMessageId === action.operationId) && item.targetTurnId === action.expectedTurnId && item.status === 'accepted') : undefined;
            const replies = readDesktopAsyncQuestionReplies(item);
            if (result?.turnId === action.expectedTurnId && request.questions.every((question) => request.answers?.[question.id]
                || replies.some((reply) => reply.questionItemId === question.id && reply.question === question.question && reply.answer === answers[question.id]![0])))
                return { status: 'accepted', turnId: action.expectedTurnId };
        }
        return { status: 'unknown', reason: 'answer_outcome_unknown' };
    } catch (error) {
        return { status: dispatched ? 'unknown' : 'rejected', reason: dispatched ? 'answer_outcome_unknown' : reasonFor(error) };
    } finally {
        control?.close();
        // 只有本调用成功独占创建且未外发的意图可移除；EEXIST 与已发未知结果都必须保留。
        if (!dispatched) for (const path of createdIntents) {
            try { await unlink(path); } catch { /* 删除失败保留原意图，下一次继续如实报告未知。 */ }
        }
    }
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
        if (action.kind === 'answer') return answerDesktopQuestions({ ...params, action });
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

export type DesktopSessionTarget = Readonly<{
    codexHome: string;
    remoteSessionId: string;
    /** 仅由认证目标的现有 lease 提供；每次使用仍核对原连接的连续控制锚。 */
    getFollowedIpc?: () => DesktopIpc | null;
}>;
export type DesktopSessionMessage = DesktopSessionTarget & Readonly<{
    text: string; localId: string; accountId: string;
    /** 已协商的普通文本协议；缺省保持已发布客户端的 start 语义。 */
    textSendProtocol?: 'native-auto-v1';
    attachments?: readonly DirectSessionUploadedAttachmentV1[];
    attachmentWorkingDirectory?: string;
}>;

/** 只规范本机路径，不创建或修改 Codex 的任何文件。 */
async function resolveHome(codexHome: string): Promise<string> {
    if (!ipcString(codexHome)) throw new DesktopIpcError('invalid_request');
    const expanded = expandHomeDirPath(codexHome);
    if (!isAbsolute(expanded)) throw new DesktopIpcError('invalid_request');
    try { return await realpath(expanded); }
    catch { throw new DesktopIpcError('router_unavailable'); }
}

/** 同步借用当前 lease 的连续控制 owner，不延长 lease 或复制状态。 */
function borrowDesktopControl(params: DesktopSessionTarget) {
    const followed = params.getFollowedIpc?.();
    const proof = followed?.getControlSnapshot(params.remoteSessionId);
    if (followed && proof) return {
        ipc: followed, ownerClientId: proof.ownerClientId,
        /** 同步投影前再次确认 lease 未撤销且连接、owner、revision 仍有连续证明。 */
        read: () => {
            const current = params.getFollowedIpc?.() === followed ? followed.getControlSnapshot(params.remoteSessionId) : null;
            if (!current || current.ownerClientId !== proof.ownerClientId) throw new DesktopIpcError('owner_changed');
            return current.state;
        },
        /** 借用者不能释放其他查看者仍在使用的连接。 */
        close: () => {},
    };
    return null;
}

/** 缺少当前控制锚时沿原短连接读取；热能力查询和投递共用同一借用校验。 */
async function acquireDesktopControl(params: DesktopSessionTarget, retainUpdates = false) {
    const followed = borrowDesktopControl(params);
    if (followed) return followed;
    const ipc = await DesktopIpc.open(await resolveHome(params.codexHome));
    try {
        const ownerClientId = await ipc.discoverOwner(params.remoteSessionId);
        const raw = await ipc.readControlSnapshot(params.remoteSessionId, retainUpdates ? () => {} : undefined);
        return { ipc, ownerClientId,
            /** 冷读取等待期间也可能撤销 RPC 身份；只复核原 getter，不借另一连接替换本次快照。 */
            read: () => {
                params.getFollowedIpc?.();
                if (!retainUpdates) return raw;
                const current = ipc.getControlSnapshot(params.remoteSessionId);
                if (!current || current.ownerClientId !== ownerClientId) throw new DesktopIpcError('owner_changed');
                return current.state;
            },
            /** 独占短连接仍由本次操作结束时关闭。 */
            close: () => ipc.close(),
        };
    } catch (error) { ipc.close(); throw error; }
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
        const home = await resolveHome(params.codexHome);
        const followed = borrowDesktopControl(params);
        if (followed) {
            followed.read();
            return { available: true, ownerClientId: followed.ownerClientId, protocolVersion: 2 };
        }
        ipc = await DesktopIpc.open(home);
        const ownerClientId = await ipc.discoverOwner(params.remoteSessionId);
        // 冷发现等待期间也可能撤销认证目标；只复核生命周期，不借用新的状态。
        params.getFollowedIpc?.();
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

/** 只释放本次独占创建且从未派发的匹配意图；清理失败也不覆盖其他请求的回执。 */
async function releaseUndispatchedIntent(intentPath: string, payloadHash: string, requestId: string): Promise<void> {
    try {
        const intent = ipcRecord(JSON.parse(await readProtectedLocalStateFile(intentPath)));
        if (intent?.version === 1 && intent.payloadHash === payloadHash && intent.requestId === requestId) {
            await removeProtectedLocalStateFile(intentPath);
        }
    } catch {
        // 无法重新证明归属或删除未完成时保持现状；后续调用仍经过原有独占/回放边界。
    }
}

/**
 * 普通文本由原生决定当前轮次；仅明确未接受的 inactive 拒绝允许再 start 一次。
 * Desktop 26.924.22138 / CLI 0.158.0-alpha.2.1：原生 JS 把 NoActiveTurn 拒绝变为下方精确文案。
 * 对应官方源码（active-turn 锁内先拒绝，之后才移交/入队输入）：
 * https://github.com/openai/codex/blob/0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807/codex-rs/core/src/session/turn_input.rs#L624-L706
 * 错误帧只有 requestId/error；既有 router 按定向 owner 请求的 requestId 回送，不补成功帧的身份字段。
 */
function isNativeInactiveRejection(response: Record<string, unknown>, conversationId: string, ownerClientId: string): boolean {
    return response.resultType === 'error'
        && response.error === `Cannot steer conversation ${conversationId} because its active turn already ended`
        && (response.method === undefined || response.method === 'thread-follower-steer-turn')
        && (response.handledByClientId === undefined || response.handledByClientId === ownerClientId);
}

/** 复用同一持久化意图；仅匹配原 owner 的成功应答和 turn ID 才算接受。 */
async function submitOnce(codexHome: string, message: DesktopSessionMessage, requestId: string,
    identity: SendIdentity): Promise<Readonly<{ result: DesktopSessionSendResult; undispatched: boolean }>> {
    let control: Awaited<ReturnType<typeof acquireDesktopControl>> | undefined;
    let textIpc: DesktopIpc | undefined;
    let ownerClientId: string | undefined;
    let dispatched = false;
    /** 未派发证明只来自本次调用过程，不能由公开状态或错误原因反推。 */
    const finish = (result: DesktopSessionSendResult) => ({ result, undispatched: !dispatched });
    try {
        let ipc: DesktopIpc;
        const nativeAuto = message.textSendProtocol === 'native-auto-v1';
        if (message.attachments?.length && !nativeAuto) throw new DesktopIpcError('unsupported_input');
        const attachmentMessage = message.attachments?.length ? await prepareDesktopAttachmentMessage({
            cwd: message.attachmentWorkingDirectory ?? '', text: message.text, localId: message.localId, attachments: message.attachments,
        }) : null;
        if (nativeAuto) {
            // 只借当前 reader 的连续 owner 证明；正文仍留在原连接，发送不排在完整历史大帧之后。
            control = borrowDesktopControl(message) ?? undefined;
            textIpc = await DesktopIpc.open(codexHome);
            message.getFollowedIpc?.();
            if (control) {
                // 初始化期间可能撤销租约、owner 或修订链；只验证原 reader，不转借后继连接。
                control.read();
                ownerClientId = textIpc.bindControlOwner(control.ipc, message.remoteSessionId);
            } else ownerClientId = await textIpc.discoverOwner(message.remoteSessionId);
            message.getFollowedIpc?.();
            ipc = textIpc;
            dispatched = true;
            const response = await ipc.request('thread-follower-steer-turn', 1, {
                conversationId: message.remoteSessionId, clientUserMessageId: message.localId,
                input: attachmentMessage?.input ?? [{ type: 'text', text: message.text, text_elements: [] }],
                attachments: attachmentMessage?.attachments ?? [],
                // cwd/workspaceRoots 由原生当前会话继承；保留原生恢复编辑框所需的完整正文/context 形状。
                restoreMessage: attachmentMessage?.restoreMessage ?? { id: message.localId, text: message.text, createdAt: Date.now(),
                    context: { prompt: message.text, addedFiles: [], fileAttachments: [], ideContext: null, imageAttachments: [] } },
            }, requestId, ownerClientId);
            message.getFollowedIpc?.();
            control?.read();
            if (!isNativeInactiveRejection(response, message.remoteSessionId, ownerClientId)) {
                if (response.resultType === 'error') {
                    const reason = desktopResponseFailure(response);
                    return finish({ ...identity, status: reason === 'owner_unavailable' || reason === 'incompatible_protocol' ? 'rejected' : 'unknown',
                        reason, ownerClientId, requestId });
                }
                const result = ipcRecord(ipcRecord(response.result)?.result);
                if (response.resultType !== 'success' || response.method !== 'thread-follower-steer-turn'
                    || response.handledByClientId !== ownerClientId || !ipcString(result?.turnId)) {
                    return finish({ ...identity, status: 'unknown', reason: 'invalid_response', ownerClientId, requestId });
                }
                return finish({ ...identity, status: 'accepted', ownerClientId, requestId, turnId: result.turnId, receiptPersisted: false });
            }
        } else {
            // 已发布客户端仍复核 start 证明；固定旧轮的显式 steer/审批也继续使用原控制锚。
            control = await acquireDesktopControl({ ...message, codexHome });
            ownerClientId = control.ownerClientId;
            const snapshot = readDesktopControlSnapshot(control.read(), message.remoteSessionId);
            if (snapshot.textSendMode !== 'start') throw new DesktopIpcError('turn_not_idle');
            ipc = control.ipc;
        }
        if (nativeAuto) { message.getFollowedIpc?.(); control?.read(); }
        dispatched = true;
        const response = await ipc.request('thread-follower-start-turn', 2, {
            conversationId: message.remoteSessionId,
            turnStart: {
                request: { threadId: message.remoteSessionId, clientUserMessageId: message.localId,
                    input: attachmentMessage?.input ?? [{ type: 'text', text: message.text, text_elements: [] }] },
                context: attachmentMessage?.startContext ?? { inheritThreadSettings: true },
            },
        }, nativeAuto ? randomUUID() : requestId, ownerClientId);
        if (nativeAuto) { message.getFollowedIpc?.(); control?.read(); }
        if (response.resultType === 'error') {
            const reason = desktopResponseFailure(response);
            return finish({ ...identity, status: reason === 'owner_unavailable' || reason === 'incompatible_protocol' ? 'rejected' : 'unknown',
                reason, ownerClientId, requestId });
        }
        const turn = ipcRecord(ipcRecord(ipcRecord(response.result)?.result)?.turn);
        if (response.resultType !== 'success' || response.method !== 'thread-follower-start-turn'
            || response.handledByClientId !== ownerClientId || !ipcString(turn?.id)) {
            // 忙时排队/其他未验证形状不能假装拒绝，更不能换 localId 自动重试。
            return finish({ ...identity, status: 'unknown', reason: 'invalid_response', ownerClientId, requestId });
        }
        return finish({ ...identity, status: 'accepted', ownerClientId, requestId, turnId: turn.id, receiptPersisted: false });
    } catch (error) {
        return finish({ ...identity, status: dispatched ? 'unknown' : 'rejected', reason: reasonFor(error), requestId,
            ...(ownerClientId ? { ownerClientId } : {}) });
    } finally { control?.close(); textIpc?.close(); }
}

/**
 * 先持久化独占意图，再向原 Desktop owner 提交；仅本次明确未派发的失败可释放意图供手动重试。
 * 意图落盘后崩溃会牺牲自动重试，保留 unknown；不能证明跨重启 exactly-once。
 * 不创建 router、app-server 或会话；新普通文本协议仅在原生明确拒绝 steer 后 start，未知结果不重投。
 */
export async function sendDesktopSessionUserMessage(params: DesktopSessionMessage): Promise<DesktopSessionSendResult> {
    const identity: SendIdentity = { localId: params.localId, remoteSessionId: params.remoteSessionId, deduplicated: false };
    if (!ipcString(params.localId) || !ipcString(params.remoteSessionId) || typeof params.text !== 'string' || (!ipcString(params.text) && !params.attachments?.length)) {
        return { ...identity, status: 'rejected', reason: 'invalid_request' };
    }
    try {
        assertDesktopPlatform();
        const codexHome = await resolveHome(params.codexHome);
        const directory = receiptDirectory(params.accountId);
        const key = digest(JSON.stringify([codexHome, params.remoteSessionId, params.localId]));
        const intentPath = join(directory, `${key}.intent.json`);
        const receiptPath = join(directory, `${key}.receipt.json`);
        // 旧文本摘要保持兼容；附件名称、路径、大小与摘要均绑定同一 localId。
        const payloadHash = digest(params.attachments?.length ? JSON.stringify([params.text, params.attachments]) : params.text);
        const requestId = randomUUID();
        try {
            // 跨进程由既有 O_EXCL + fsync 工具保证只有一个提交者，不依赖内存 map。
            await createProtectedLocalStateFileExclusive(intentPath, JSON.stringify({ version: 1, payloadHash, requestId }));
        } catch (error) {
            if (ipcRecord(error)?.code === 'EEXIST') return replayIntent(intentPath, receiptPath, payloadHash, identity);
            throw error;
        }
        const { result, undispatched } = await submitOnce(codexHome, params, requestId, identity);
        if (undispatched && result.status === 'rejected') {
            await releaseUndispatchedIntent(intentPath, payloadHash, requestId);
            // 释放后可能已有新请求进入；无论清理成败，都不再写本次永久拒绝回执。
            return result;
        }
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
