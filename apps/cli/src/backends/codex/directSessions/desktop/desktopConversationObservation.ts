import type { DirectSessionObservationV1 } from '@happier-dev/protocol';

/** 收窄不受信任的 Desktop 快照，不保留正文和路径。 */
function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 依据 Desktop 10492 的 Ng/Eg/mv 选择尾部 turn 和尚未解决的原生请求。 */
export function readDesktopConversationObservation(value: unknown, conversationId: string): DirectSessionObservationV1 {
    const unknown = (reason: 'invalid_snapshot' | 'missing_turn_id' | 'unsupported_request'): DirectSessionObservationV1 => ({ v: 1, state: 'unknown', reason });
    const state = record(value);
    if (state?.id !== conversationId || !Array.isArray(state.requests)) return unknown('invalid_snapshot');
    let turn: Record<string, unknown> | null;
    const historyContainer = record(state.turnHistory);
    if (historyContainer?.kind === 'canonical') {
        const history = record(historyContainer.history);
        const islands = history?.islands;
        const last = Array.isArray(islands) ? record(islands.at(-1)) : null;
        const entries = last?.entries;
        // 没有已加载的最新边界时不能将历史最后一条冒充当前 turn。
        if (record(last?.newerBoundary)?.status !== 'exhausted' || !Array.isArray(entries)) return unknown('invalid_snapshot');
        const key = record(entries.at(-1))?.value;
        turn = typeof key === 'string' ? record(record(history?.entitiesByKey)?.[key]) : null;
    } else {
        turn = Array.isArray(state.turns) ? record(state.turns.at(-1)) : null;
    }
    if (!turn || typeof turn.turnId !== 'string' || !turn.turnId.trim()) return unknown('missing_turn_id');
    const base = { v: 1 as const, source: 'desktop' as const, turnId: turn.turnId };
    if (turn.status === 'completed' || turn.status === 'failed') return { ...base, state: turn.status };
    if (turn.status === 'interrupted') return { ...base, state: 'cancelled' };
    if (turn.status !== 'inProgress') return unknown('invalid_snapshot');
    const requests: Array<{ requestId: string; kind: 'permission_request' | 'user_action_request' }> = [];
    for (const raw of state.requests) {
        const request = record(raw);
        const params = record(request?.params);
        if (!request || !params || request.completed === true) continue;
        if (params.threadId !== conversationId || params.turnId !== turn.turnId) continue;
        const requestId = typeof request.id === 'string' && request.id.trim() ? request.id
            : typeof request.id === 'number' && Number.isSafeInteger(request.id) ? String(request.id) : null;
        if (!requestId) return unknown('unsupported_request');
        if (request.method === 'item/tool/requestUserInput') requests.push({ requestId, kind: 'user_action_request' });
        else if (request.method === 'item/commandExecution/requestApproval' || request.method === 'item/permissions/requestApproval') {
            requests.push({ requestId, kind: 'permission_request' });
        } else if (request.method === 'item/fileChange/requestApproval') {
            const item = Array.isArray(turn.items) ? turn.items.map(record).find((item) => item?.id === params.itemId && item?.type === 'fileChange') : null;
            if (!item || !Array.isArray(item.changes)) return unknown('unsupported_request');
            if (item.changes.some((change) => record(record(change)?.kind)?.type !== 'delete')) requests.push({ requestId, kind: 'permission_request' });
        } else return unknown('unsupported_request');
    }
    return requests.length > 0 ? { ...base, state: 'needs_input', requests } : { ...base, state: 'running' };
}
