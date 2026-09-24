import { createHash } from 'node:crypto';
import type { DesktopApprovalV1, DesktopControlSnapshotV1 } from '@happier-dev/protocol';
import { DesktopIpcError, ipcRecord, ipcString } from './desktopIpc';

/** 从已加载的最新尾岛选择原轮次，不把不完整历史的末项当当前任务。 */
function currentTurn(state: Record<string, unknown>): Record<string, unknown> | null {
    const container = ipcRecord(state.turnHistory);
    if (container?.kind !== 'canonical') return Array.isArray(state.turns) ? ipcRecord(state.turns.at(-1)) : null;
    const history = ipcRecord(container.history);
    const islands = history?.islands;
    const island = Array.isArray(islands) ? ipcRecord(islands.at(-1)) : null;
    if (ipcRecord(island?.newerBoundary)?.status !== 'exhausted' || !Array.isArray(island?.entries)) return null;
    const key = ipcRecord(island.entries.at(-1))?.value;
    return typeof key === 'string' ? ipcRecord(ipcRecord(history?.entitiesByKey)?.[key]) : null;
}

/** 校验实时 runtime 与最新尾轮后投影控制快照；文本选路不确认观察生命周期。 */
export function readDesktopControlSnapshot(value: unknown, conversationId: string): DesktopControlSnapshotV1 {
    const state = ipcRecord(value);
    if (state?.id !== conversationId || !Array.isArray(state.requests)) throw new DesktopIpcError('invalid_snapshot');
    const turn = currentTurn(state);
    if (!ipcString(turn?.turnId)) throw new DesktopIpcError('missing_turn_id');
    const status = turn.status === 'inProgress' ? 'running' : turn.status === 'interrupted' ? 'cancelled' : turn.status;
    if (status !== 'running' && status !== 'completed' && status !== 'failed' && status !== 'cancelled') throw new DesktopIpcError('invalid_snapshot');
    const runtime = ipcRecord(state.threadRuntimeStatus)?.type;
    // active 配旧终态、idle 配运行轮及缺失 runtime 都不是安全的当前控制依据。
    if (runtime !== (status === 'running' ? 'active' : 'idle')) throw new DesktopIpcError('invalid_snapshot');
    const requests: DesktopApprovalV1[] = [];
    for (const value of state.requests) {
        const request = ipcRecord(value);
        const params = ipcRecord(request?.params);
        if (!request || !params || request.completed === true || params.threadId !== conversationId || params.turnId !== turn.turnId) continue;
        const id = request.id;
        if (!(ipcString(id) || typeof id === 'number' && Number.isSafeInteger(id))) throw new DesktopIpcError('unsupported_request');
        let details: Omit<DesktopApprovalV1, 'requestId' | 'revision'> = { kind: 'unsupported', canDecide: false, reason: 'unsupported_request' };
        if (request.method === 'item/commandExecution/requestApproval') {
            const cwd = ipcString(params.cwd) ? params.cwd : state.cwd;
            const supportedDecisions = params.availableDecisions == null || Array.isArray(params.availableDecisions)
                && params.availableDecisions.includes('accept') && params.availableDecisions.includes('decline');
            details = { kind: 'command', canDecide: ipcString(params.command) && ipcString(cwd) && supportedDecisions && params.networkApprovalContext == null,
                ...(typeof params.command === 'string' ? { command: params.command } : {}),
                ...(typeof cwd === 'string' ? { cwd } : {}) };
        } else if (request.method === 'item/fileChange/requestApproval') {
            const item = Array.isArray(turn.items) ? turn.items.map(ipcRecord).find((item) => item?.id === params.itemId && item?.type === 'fileChange') : null;
            const changes = Array.isArray(item?.changes) ? item.changes : [];
            const files: NonNullable<DesktopApprovalV1['files']> = [];
            for (const raw of changes) {
                const change = ipcRecord(raw);
                const kind = ipcRecord(change?.kind)?.type;
                if (!ipcString(change?.path) || !ipcString(kind)) continue;
                files.push({ path: change.path, kind, ...(typeof change.diff === 'string' ? { diff: change.diff } : {}) });
            }
            details = { kind: 'file_change', canDecide: files.length > 0 && files.length === changes.length && files.every((file) => ipcString(file.diff)), files };
        }
        if (!details.canDecide && !details.reason) details.reason = 'approval_details_incomplete';
        // 修订绑定完整原请求和展示详情，命令/范围改变后旧手机决定必须失效。
        const revision = createHash('sha256').update(JSON.stringify([turn.turnId, request.method, request.params, details])).digest('hex');
        requests.push({ requestId: String(id), revision, ...details });
    }
    // 原 owner 会拒绝尚未确认提交后的文本；终态仍挂着同轮请求时也不能开始新轮。
    const submissions = state.unconfirmedTurnSubmissions;
    const hasUnconfirmedSubmission = submissions != null && (!Array.isArray(submissions) || submissions.length > 0);
    const textSendMode = !hasUnconfirmedSubmission && (status === 'running' || requests.length === 0)
        ? status === 'running' ? 'steer' as const : 'start' as const
        : undefined;
    return { v: 1, turnId: turn.turnId, state: status, ...(textSendMode ? { textSendMode } : {}),
        ...(typeof state.cwd === 'string' ? { cwd: state.cwd } : {}), requests };
}

/** 按当前快照取回原始数值或字符串 ID，避免数字请求被字符串化后错投。 */
export function readNativeApprovalRequestId(value: unknown, requestId: string): string | number {
    const requests = ipcRecord(value)?.requests;
    if (Array.isArray(requests)) for (const raw of requests) {
        const id = ipcRecord(raw)?.id;
        if ((typeof id === 'string' || typeof id === 'number') && String(id) === requestId) return id;
    }
    throw new DesktopIpcError('request_expired');
}
