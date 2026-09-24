import * as React from 'react';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import type { DesktopApprovalV1, DesktopControlSnapshotV1, DirectSessionControlActionRequest } from '@happier-dev/protocol';
import { machineDirectSessionControlRead, machineDirectSessionControlAction } from '@/sync/ops/machineDirectSessions';
import { useActiveServerAccountScope } from '@/sync/store/hooks';
import { randomUUID } from '@/platform/randomUUID';

type ControlOutcome = 'accepted' | 'unknown' | 'rejected';
type ControlOutcomeContext = Readonly<{ kind: 'start' | 'steer' | 'approval'; turnId: string }>;
type TextSendResult = Readonly<{ outcome: ControlOutcome; mode?: 'start' | 'steer' }>;
type StartTextSend = (isCurrent: () => boolean) => Promise<ControlOutcome>;
type ControlViewState = {
    snapshot: DesktopControlSnapshotV1 | null;
    error: string | null;
    busy: boolean;
    loading: boolean;
    outcome: ControlOutcome | null;
    outcomeContext: ControlOutcomeContext | null;
};
const EMPTY_CONTROL_VIEW: ControlViewState = { snapshot: null, error: null, busy: false, loading: false, outcome: null, outcomeContext: null };

/** 原桌面控制的单一界面寿命：隔离账号目标、拒绝陈旧回包，并保留未知操作结果。 */
export function useDirectSessionControl(params: Readonly<{
    sessionId: string;
    machineId: string | null;
    serverId?: string;
    enabled: boolean;
    observationKey: string;
}>) {
    const scope = useActiveServerAccountScope();
    const serverId = params.serverId ?? scope?.serverId;
    // 路由可保留 profile 别名；由现有服务器 owner 判断同服，仍拒绝跨服控制。
    const enabled = params.enabled && Boolean(scope && params.machineId && areServerProfileIdentifiersEquivalent(serverId, scope.serverId));
    const identity = JSON.stringify([scope?.accountId, serverId, params.machineId, params.sessionId]);
    // A→B→A 与暂时停用也开启新寿命，旧回包和 finally 不能写入新锁。
    const lifetime = React.useMemo(() => ({
        readVersion: 0,
        flight: null as object | null,
        issued: new Set<string>(),
        uncertainTextSendKey: null as string | null,
    }), [identity, enabled]);
    const current = React.useRef<typeof lifetime | null>(lifetime);
    current.current = lifetime;
    const [viewState, setViewState] = React.useState<ControlViewState & { lifetime: object }>(() => ({ ...EMPTY_CONTROL_VIEW, lifetime }));
    // 渲染本帧就隔离身份，不能等 effect 才清除上一账号审批内容。
    const view = viewState.lifetime === lifetime ? viewState : EMPTY_CONTROL_VIEW;
    const { snapshot, error, busy, loading, outcome } = view;

    /** 所有异步分支都绑定调用开始时的完整身份与启用寿命。 */
    const isCurrent = React.useCallback(() => enabled && current.current === lifetime, [enabled, lifetime]);
    /** 只更新当前寿命的界面，不把旧账号结果短暂显示在新账号中。 */
    const updateView = React.useCallback((patch: Partial<ControlViewState>) => {
        if (!isCurrent()) return;
        setViewState((previous) => {
            if (!isCurrent()) return previous;
            const next = { ...(previous.lifetime === lifetime ? previous : EMPTY_CONTROL_VIEW), ...patch, lifetime };
            const context = next.outcomeContext;
            const observed = next.snapshot;
            // 只清理已被真实新进展替代的受理文案；不推导完成，也不触碰未知结果或去重锁。
            const acceptedHintIsObsolete = next.outcome === 'accepted' && context && observed && (
                (context.kind === 'start' && observed.turnId !== context.turnId)
                || (context.kind === 'steer' && observed.turnId === context.turnId && observed.state !== 'running')
            );
            return acceptedHintIsObsolete ? { ...next, outcome: null, outcomeContext: null } : next;
        });
    }, [isCurrent, lifetime]);

    /** 返回本次读取值；同账号同目标也只接纳最后一次读取，失败不会返回缓存。 */
    const refresh = React.useCallback(async (): Promise<DesktopControlSnapshotV1 | null> => {
        if (!isCurrent() || !params.machineId) return null;
        const version = ++lifetime.readVersion;
        updateView({ loading: true });
        try {
            const response = await machineDirectSessionControlRead({ machineId: params.machineId, sessionId: params.sessionId }, { serverId });
            if (!isCurrent() || lifetime.readVersion !== version) return null;
            if (response.ok) {
                updateView({ snapshot: response.snapshot, error: null });
                return response.snapshot;
            }
            updateView({ snapshot: null, error: response.error });
        } catch (cause) {
            if (!isCurrent() || lifetime.readVersion !== version) return null;
            updateView({ snapshot: null, error: cause instanceof Error ? cause.message : '暂时无法读取桌面状态' });
        } finally {
            if (lifetime.readVersion === version) updateView({ loading: false });
        }
        return null;
    }, [isCurrent, lifetime, params.machineId, params.sessionId, serverId, updateView]);

    React.useEffect(() => {
        current.current = lifetime;
        return () => {
            lifetime.readVersion += 1;
            if (current.current === lifetime) current.current = null;
        };
    }, [lifetime]);
    React.useEffect(() => { void refresh(); }, [refresh, params.observationKey]);

    /** 审批和文本共用单飞锁；文本从读取之前就占有，避免双击分别放行。 */
    const acquireFlight = React.useCallback(() => {
        if (!isCurrent() || lifetime.flight) return null;
        const flight = {};
        lifetime.flight = flight;
        updateView({ busy: true, outcome: null, outcomeContext: null });
        return flight;
    }, [isCurrent, lifetime, updateView]);
    /** 仅释放自己取得的锁，迟到请求不能结束新目标的忙状态。 */
    const releaseFlight = React.useCallback((flight: object) => {
        if (lifetime.flight !== flight) return;
        lifetime.flight = null;
        updateView({ busy: false });
    }, [lifetime, updateView]);

    /** 发出一次控制请求；ACK 只表示接收，不将未知或异轮次回执标为完成。 */
    const dispatch = React.useCallback(async (
        action: DirectSessionControlActionRequest,
        isFlightCurrent: () => boolean,
    ): Promise<ControlOutcome> => {
        if (!isFlightCurrent()) return 'rejected';
        let wasIssued = false;
        try {
            const response = await machineDirectSessionControlAction(action, { serverId, onIssued: () => { wasIssued = true; } });
            if (!isFlightCurrent()) return 'unknown';
            const accepted = action.kind === 'steer' && response.ok && response.result.status === 'accepted' && response.result.turnId === action.expectedTurnId;
            const result = accepted ? 'accepted' : response.ok && response.result.status !== 'rejected' ? 'unknown' : 'rejected';
            updateView({ outcome: result, ...(!response.ok ? { error: response.error } : {}) });
            await refresh();
            return isFlightCurrent() ? result : 'unknown';
        } catch {
            // 目标解析等发出前失败可重试；传输已接收后的断线必须保留未知并锁住原操作。
            const result = wasIssued ? 'unknown' : 'rejected';
            if (isFlightCurrent()) updateView({ outcome: result });
            return result;
        }
    }, [refresh, serverId, updateView]);

    /** 同轮次、同请求和同版本的待确认决定只发一次；明确拒绝后可由用户重试。 */
    const decide = React.useCallback(async (request: DesktopApprovalV1, decision: 'allow_once' | 'deny') => {
        if (!snapshot || snapshot.state !== 'running' || !params.machineId || !request.canDecide) return;
        const actual = snapshot.requests.find((item) => item.requestId === request.requestId && item.revision === request.revision);
        if (!actual?.canDecide) return;
        const key = JSON.stringify([snapshot.turnId, request.requestId, request.revision]);
        if (lifetime.issued.has(key)) return;
        const flight = acquireFlight();
        if (!flight) return;
        const isFlightCurrent = () => isCurrent() && lifetime.flight === flight;
        lifetime.issued.add(key);
        updateView({ outcomeContext: { kind: 'approval', turnId: snapshot.turnId } });
        try {
            const result = await dispatch({ machineId: params.machineId, sessionId: params.sessionId, kind: 'approval', operationId: randomUUID(), expectedTurnId: snapshot.turnId, requestId: request.requestId, revision: request.revision, decision }, isFlightCurrent);
            // 只有明确未提交才解除本地锁；未知结果保持锁定，刷新不会重放授权。
            if (result === 'rejected' && isFlightCurrent()) lifetime.issued.delete(key);
        } finally {
            releaseFlight(flight);
        }
    }, [acquireFlight, dispatch, isCurrent, lifetime, params.machineId, params.sessionId, releaseFlight, snapshot, updateView]);

    /** 原桌面新快照是文本选路的唯一依据；不从历史观察状态推断发送能力。 */
    const sendTextWithMode = React.useCallback(async (
        text: string,
        start: StartTextSend,
        requiredMode?: 'steer',
    ): Promise<TextSendResult> => {
        if (!isCurrent()) return { outcome: 'unknown' };
        if (!params.machineId || !text.trim()) return { outcome: 'rejected' };
        const flight = acquireFlight();
        if (!flight) return { outcome: 'unknown' };
        const isFlightCurrent = () => isCurrent() && lifetime.flight === flight;
        try {
            const fresh = await refresh();
            const mode = fresh?.textSendMode;
            if (!isFlightCurrent() || !fresh || !fresh.turnId.trim()
                || (mode !== 'start' && mode !== 'steer')
                || (mode === 'steer' && fresh.state !== 'running')
                || (mode === 'start' && !['completed', 'failed', 'cancelled'].includes(fresh.state))
                || (requiredMode && mode !== requiredMode)) {
                if (isFlightCurrent()) updateView({ outcome: 'rejected' });
                return { outcome: isFlightCurrent() ? 'rejected' : 'unknown' };
            }
            // 种类与基准轮次仅用于提示措辞和失效判断，不参与发送授权或锁的生命周期。
            const outcomeContext: ControlOutcomeContext = { kind: mode, turnId: fresh.turnId };
            updateView({ outcomeContext });
            const key = JSON.stringify([mode, fresh.turnId]);
            if (lifetime.uncertainTextSendKey === key) {
                updateView({ outcome: 'unknown' });
                return { outcome: 'unknown', mode };
            }
            lifetime.uncertainTextSendKey = key;
            let result: ControlOutcome;
            try {
                result = mode === 'steer'
                    ? await dispatch({ machineId: params.machineId, sessionId: params.sessionId, kind: 'steer', operationId: randomUUID(), expectedTurnId: fresh.turnId, text }, isFlightCurrent)
                    : await start(isFlightCurrent);
            } catch {
                // start 的既有发送 owner 未给明确拒绝时，不假定消息没有发出。
                result = 'unknown';
            }
            if (!isFlightCurrent()) return { outcome: 'unknown', mode };
            if (result !== 'unknown') lifetime.uncertainTextSendKey = null;
            // 观察可能先于 ACK 到达；用同一上下文合并，避免迟到受理重新挂回旧文案。
            updateView({ outcome: result, outcomeContext });
            return { outcome: result, mode };
        } finally {
            releaseFlight(flight);
        }
    }, [acquireFlight, dispatch, isCurrent, lifetime, params.machineId, params.sessionId, refresh, releaseFlight, updateView]);

    /** 普通文本允许明确的 start 或 steer，实际开始仍交给既有 SEND owner。 */
    const sendText = React.useCallback((text: string, start: StartTextSend) => sendTextWithMode(text, start), [sendTextWithMode]);
    /** 兼容原追加入口但不扩大意图：最新快照只允许 start 时仍拒绝追加调用。 */
    const steer = React.useCallback(async (text: string): Promise<boolean> => {
        const result = await sendTextWithMode(text, async () => 'rejected', 'steer');
        return result.outcome === 'accepted';
    }, [sendTextWithMode]);
    /** 决策按钮复用单次发出记录，刷新不会把仍未确认的同一请求重新启用。 */
    const isRequestLocked = React.useCallback((request: DesktopApprovalV1) =>
        lifetime.issued.has(JSON.stringify([snapshot?.turnId, request.requestId, request.revision])), [lifetime, snapshot?.turnId]);
    const outcomeKind = view.outcomeContext?.kind ?? null;
    return React.useMemo(() => ({ snapshot: enabled ? snapshot : null, error, busy, loading, outcome, outcomeKind, refresh, decide, sendText, steer, isRequestLocked }),
        [enabled, snapshot, error, busy, loading, outcome, outcomeKind, refresh, decide, sendText, steer, isRequestLocked]);
}
