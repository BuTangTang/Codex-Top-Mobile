import * as React from 'react';
import { useDirectSessionControl } from './useDirectSessionControl';
import { AppState } from 'react-native';
import type { DirectSessionAttachRequest, DirectSessionStatusGetResponse } from '@happier-dev/protocol';

import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { readDirectSessionLink } from '@/sync/domains/session/directSessions/readDirectSessionLink';
import type { Metadata } from '@/sync/domains/state/storageTypes';
import { machineDirectSessionAttach, machineDirectSessionDetach, machineDirectSessionFollowPolicySet, machineDirectSessionStatusGet } from '@/sync/ops/machineDirectSessions';
import { randomUUID } from '@/platform/randomUUID';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { sync } from '@/sync/sync';

export type DirectSessionRuntimeStatus = Extract<DirectSessionStatusGetResponse, { ok: true }>;

type UseDirectSessionRuntimeParams = Readonly<{
    sessionId: string;
    metadata: Metadata | null | undefined;
    enabled?: boolean;
    viewerActive?: boolean;
    serverId?: string | null;
}>;

// 与 daemon 的既有租约约定一致；从本地请求开始计时，不比较电脑与手机的绝对时间。
const VIEWER_TTL_MS = 45_000;
const VIEWER_RENEW_MS = 15_000;
type ViewerLease = {
    key: string;
    serverId: string | undefined;
    input: DirectSessionAttachRequest & { leaseId: string };
    validUntilMs: number;
    inFlight: Promise<boolean> | null;
    timer: ReturnType<typeof setTimeout> | null;
};

/** 仅核心目标决定租约身份；关注策略、通知检查点和活动时间回声不会更换观察连接。 */
function buildDirectSessionViewerTargetKey(
    sessionId: string,
    serverId: string | undefined,
    link: ReturnType<typeof readDirectSessionLink>,
): string {
    return JSON.stringify([
        sessionId, serverId, link?.providerId, link?.machineId, link?.remoteSessionId, link?.source,
    ]);
}

/** 释放捕获的旧目标；断线时由 daemon TTL 回收，不把清理错误发布到新页面。 */
function detachViewer(viewer: ViewerLease, leaseId = viewer.input.leaseId): void {
    void machineDirectSessionDetach({ machineId: viewer.input.machineId, sessionId: viewer.input.sessionId, leaseId },
        { serverId: viewer.serverId }).catch(() => {});
}

export type UseDirectSessionRuntimeResult = Readonly<{
    control: ReturnType<typeof useDirectSessionControl> | null;
    directSessionLink: ReturnType<typeof readDirectSessionLink>;
    status: DirectSessionRuntimeStatus | null;
    refreshNow: () => Promise<DirectSessionRuntimeStatus | null>;
    notificationsBusy: boolean;
    setNotificationsEnabled: (enabled: boolean) => Promise<boolean | null>;
}>;

function normalizeServerId(value: unknown): string | undefined {
    const serverId = String(value ?? '').trim();
    return serverId || undefined;
}

function readActivePollMsFromEnv(): number {
    const raw = Number.parseInt(String(process.env.EXPO_PUBLIC_HAPPIER_DIRECT_SESSIONS_TAIL_POLL_MS_ACTIVE ?? ''), 10);
    const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 250;
    return Math.max(50, Math.min(60_000, configured));
}

function readIdlePollMsFromEnv(): number {
    const raw = Number.parseInt(String(process.env.EXPO_PUBLIC_HAPPIER_DIRECT_SESSIONS_TAIL_POLL_MS_IDLE ?? ''), 10);
    const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 2_000;
    return Math.max(100, Math.min(120_000, configured));
}

function resolvePollDelayMs(status: DirectSessionRuntimeStatus | null): number {
    if (status?.machineOnline === false) return readIdlePollMsFromEnv();
    if (status?.activity === 'running' || status?.activity === 'active_recently') {
        return readActivePollMsFromEnv();
    }
    return readIdlePollMsFromEnv();
}

function buildDirectSessionLinkCacheKey(metadata: Metadata | null | undefined): string {
    if (!metadata || typeof metadata !== 'object') return 'none';
    const directSessionV1 = (metadata as { directSessionV1?: unknown }).directSessionV1;
    if (directSessionV1 == null) return 'none';
    try {
        return JSON.stringify(directSessionV1) ?? 'none';
    } catch {
        return 'unserializable';
    }
}

function readDirectSessionLinkFromCacheKey(cacheKey: string): ReturnType<typeof readDirectSessionLink> {
    if (cacheKey === 'none' || cacheKey === 'unserializable') return null;
    try {
        return readDirectSessionLink({ directSessionV1: JSON.parse(cacheKey) });
    } catch {
        return null;
    }
}

// 按能力内容比较嵌套字段，避免轮询反复发布内容相同的桌面控制状态。
export function areDirectSessionRuntimeStatusesEqual(
    left: DirectSessionRuntimeStatus | null,
    right: DirectSessionRuntimeStatus | null,
): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    const leftKeys = Object.keys(left) as Array<keyof DirectSessionRuntimeStatus>;
    const rightKeys = Object.keys(right) as Array<keyof DirectSessionRuntimeStatus>;
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
        if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
        if (key === 'externalControl') {
            if (left.externalControl?.canSend !== right.externalControl?.canSend
                || left.externalControl?.unavailableReason !== right.externalControl?.unavailableReason) {
                return false;
            }
            continue;
        }
        if (key === 'notifications') {
            if (left.notifications?.capability !== right.notifications?.capability
                || left.notifications?.enabled !== right.notifications?.enabled
                || left.notifications?.delivery !== right.notifications?.delivery) return false;
            continue;
        }
        if (key === 'observation') {
            const a = left.observation;
            const b = right.observation;
            if (a === b) continue;
            if (!a || !b || a.state !== b.state) return false;
            if (a.state === 'unknown' || b.state === 'unknown') {
                if (a.state !== 'unknown' || b.state !== 'unknown' || a.reason !== b.reason) return false;
            } else {
                if (a.source !== b.source || a.turnId !== b.turnId) return false;
                if (a.state === 'needs_input' && b.state === 'needs_input'
                    && (a.requests.length !== b.requests.length || a.requests.some((request, index) =>
                        request.requestId !== b.requests[index]?.requestId || request.kind !== b.requests[index]?.kind))) return false;
            }
            continue;
        }
        if (!Object.is(left[key], right[key])) return false;
    }
    return true;
}

/** 页面唯一 Direct owner：先取得 viewer，再读取状态；失焦和后台保留正文但停止观察。 */
export function useDirectSessionRuntime(params: UseDirectSessionRuntimeParams): UseDirectSessionRuntimeResult {
    const enabled = params.enabled !== false;
    const directSessionLinkCacheKey = React.useMemo(
        () => buildDirectSessionLinkCacheKey(params.metadata),
        [params.metadata],
    );
    const directSessionLink = React.useMemo(
        () => enabled ? readDirectSessionLinkFromCacheKey(directSessionLinkCacheKey) : null,
        [directSessionLinkCacheKey, enabled],
    );
    const activeServerSnapshot = useActiveServerSnapshot();
    const [status, setStatus] = React.useState<DirectSessionRuntimeStatus | null>(null);
    const statusRef = React.useRef<DirectSessionRuntimeStatus | null>(null);
    const inFlightRefreshRef = React.useRef<Promise<DirectSessionRuntimeStatus | null> | null>(null);
    // 只保存本 runtime 尚未结束的正文请求；按 sync 的 sessionId owner 合并，不缓存正文或状态。
    const inFlightTranscriptsRef = React.useRef(new Map<string, Promise<void>>());
    const generationRef = React.useRef(0);
    const inFlightFollowRef = React.useRef<Promise<boolean | null> | null>(null);
    const [notificationsBusy, setNotificationsBusy] = React.useState(false);
    const previousTargetKeyRef = React.useRef<string | undefined>(undefined);
    const committedViewerDemandRef = React.useRef<{ targetKey: string; active: boolean } | null>(null);
    const viewerRef = React.useRef<ViewerLease | null>(null);
    const foregroundRef = React.useRef(AppState.currentState === 'active');
    const [foreground, setForeground] = React.useState(foregroundRef.current);
    const viewerActive = enabled && params.viewerActive !== false && foreground;
    const activeServerId = normalizeServerId(activeServerSnapshot.serverId);
    const explicitServerId = normalizeServerId(params.serverId);
    // A disabled runtime resolves nothing. Every other branch below already short-circuits on
    // `enabled`, but this one used to reach into the session/server cache on every render of every
    // caller that had already been handed a runtime by its parent — work whose result is then thrown
    // away, and a global store read that a caller with no direct session has no reason to make.
    const sessionServerId = React.useMemo(
        () => (enabled ? explicitServerId ?? resolvePreferredServerIdForSessionId(params.sessionId) ?? activeServerId : undefined),
        [activeServerId, enabled, explicitServerId, params.sessionId],
    );
    // 能力归属完整会话目标，不能只按服务器复用同一条正在进行的探测。
    const targetKey = buildDirectSessionViewerTargetKey(params.sessionId, sessionServerId, directSessionLink);

    /** 撤回旧生命周期与能力，保留已显示的普通摘要，不把缺失观察伪装成完成。 */
    const markUnavailable = React.useCallback(() => {
        if (!statusRef.current) return;
        const { externalControl: _control, notifications: _notifications, ...cached } = statusRef.current;
        const next: DirectSessionRuntimeStatus = {
            ...cached, observation: { v: 1, state: 'unknown', reason: 'source_unavailable' },
        };
        if (!areDirectSessionRuntimeStatusesEqual(statusRef.current, next)) {
            statusRef.current = next;
            setStatus(next);
        }
    }, []);

    /** 同步取消旧操作并清除 busy，再释放租约；所有调用分支共享清理，避免回执失去清理 owner。 */
    const releaseViewer = React.useCallback(() => {
        const viewer = viewerRef.current;
        viewerRef.current = null;
        generationRef.current += 1;
        inFlightRefreshRef.current = null;
        inFlightFollowRef.current = null;
        setNotificationsBusy(false);
        if (viewer) {
            if (viewer.timer !== null) clearTimeout(viewer.timer);
            detachViewer(viewer);
        }
    }, []);

    React.useLayoutEffect(() => {
        if (!enabled || !directSessionLink) return;
        /** AppState 事件中先同步释放，避免 React 提交前的旧回执恢复能力。 */
        const updateForeground = (nextState: string | null) => {
            const next = nextState === 'active';
            foregroundRef.current = next;
            if (!next) {
                releaseViewer();
                markUnavailable();
            }
            setForeground(next);
        };
        updateForeground(AppState.currentState);
        const subscription = AppState.addEventListener('change', updateForeground);
        return () => subscription.remove();
    }, [directSessionLink, enabled, markUnavailable, releaseViewer]);

    React.useLayoutEffect(() => {
        committedViewerDemandRef.current = { targetKey, active: viewerActive };
        if (previousTargetKeyRef.current === targetKey && viewerActive) {
            return;
        }
        releaseViewer();
        if (previousTargetKeyRef.current !== undefined) {
            if (previousTargetKeyRef.current !== targetKey && statusRef.current !== null) {
                statusRef.current = null;
                setStatus(null);
            } else {
                markUnavailable();
            }
        }
        previousTargetKeyRef.current = targetKey;
    }, [markUnavailable, releaseViewer, targetKey, viewerActive]);

    /** 同一页面激活只允许一份 attach/续租；迟到成功只清理捕获的旧租约。 */
    const attachViewer = React.useCallback(function attach(viewer: ViewerLease): Promise<boolean> {
        if (viewerRef.current !== viewer || !foregroundRef.current) return Promise.resolve(false);
        if (viewer.inFlight) return viewer.inFlight;
        const startedAt = Date.now();
        if (viewer.timer !== null) clearTimeout(viewer.timer);
        // 续租请求卡住也必须在原 TTL 到期时撤回状态，不能等正文刷新或网络超时。
        if (viewer.validUntilMs > 0) {
            viewer.timer = setTimeout(() => {
                if (viewerRef.current !== viewer) return;
                viewer.validUntilMs = 0;
                generationRef.current += 1;
                markUnavailable();
            }, Math.max(0, viewer.validUntilMs - startedAt));
        }
        const operation = (async () => {
            try {
                const response = await machineDirectSessionAttach(viewer.input, { serverId: viewer.serverId });
                if (viewerRef.current !== viewer || !foregroundRef.current) {
                    if (response.ok) detachViewer(viewer, response.leaseId);
                    return false;
                }
                if (response.ok) viewer.input = { ...viewer.input, leaseId: response.leaseId };
                if (!response.ok || Date.now() >= startedAt + VIEWER_TTL_MS) {
                    viewer.validUntilMs = 0;
                    generationRef.current += 1;
                    markUnavailable();
                    return false;
                }
                viewer.validUntilMs = startedAt + VIEWER_TTL_MS;
                return true;
            } catch {
                if (viewerRef.current === viewer) {
                    viewer.validUntilMs = 0;
                    generationRef.current += 1;
                    markUnavailable();
                }
                return false;
            } finally {
                viewer.inFlight = null;
                if (viewerRef.current === viewer) {
                    if (viewer.timer !== null) clearTimeout(viewer.timer);
                    // 仅租约定时器独立于正文；状态仍由原来的唯一 poller 读取。
                    const delay = viewer.validUntilMs > Date.now()
                        ? Math.max(0, startedAt + VIEWER_RENEW_MS - Date.now())
                        : readIdlePollMsFromEnv();
                    viewer.timer = setTimeout(() => { void attach(viewer); }, delay);
                }
            }
        })();
        viewer.inFlight = operation;
        return operation;
    }, [markUnavailable]);

    /** 先确认当前页面租约再查询；失败或目标变化返回空值，不能用旧缓存授权发送。 */
    const refreshNow = React.useCallback(async (): Promise<DirectSessionRuntimeStatus | null> => {
        if (!viewerActive || !foregroundRef.current || !committedViewerDemandRef.current?.active
            || committedViewerDemandRef.current.targetKey !== targetKey) {
            return null;
        }
        if (!directSessionLink) {
            if (statusRef.current !== null) {
                statusRef.current = null;
                setStatus(null);
            }
            return null;
        }

        const targetServerId = explicitServerId ?? resolvePreferredServerIdForSessionId(params.sessionId) ?? activeServerId;
        const key = buildDirectSessionViewerTargetKey(params.sessionId, targetServerId, directSessionLink);
        if (viewerRef.current?.key !== key) {
            releaseViewer();
            if (statusRef.current !== null) {
                statusRef.current = null;
                setStatus(null);
            }
            viewerRef.current = {
                key, serverId: targetServerId,
                input: {
                    machineId: directSessionLink.machineId, sessionId: params.sessionId,
                    providerId: directSessionLink.providerId, remoteSessionId: directSessionLink.remoteSessionId,
                    source: directSessionLink.source, leaseId: randomUUID(), ttlMs: VIEWER_TTL_MS,
                },
                validUntilMs: 0, inFlight: null, timer: null,
            };
        }
        const viewer = viewerRef.current;
        if (inFlightRefreshRef.current) {
            return inFlightRefreshRef.current;
        }

        const currentGeneration = generationRef.current;
        let refreshPromise: Promise<DirectSessionRuntimeStatus | null> | null = null;
        refreshPromise = (async () => {
            if (viewer.validUntilMs <= Date.now() && !await attachViewer(viewer)) return null;
            if (viewerRef.current !== viewer || generationRef.current !== currentGeneration || !foregroundRef.current) return null;
            const statusPromise = machineDirectSessionStatusGet({
                machineId: directSessionLink.machineId,
                sessionId: params.sessionId,
                providerId: directSessionLink.providerId,
                remoteSessionId: directSessionLink.remoteSessionId,
                source: directSessionLink.source,
            }, { serverId: targetServerId })
                .then((response) => ({ ok: true as const, response }))
                .catch((error: unknown) => ({ ok: false as const, error }));

            // 正文可能无限重试或等待前台恢复，不能阻塞状态发布，也不能逐 tick 堆积等待者。
            // 正文结束仅释放本地单飞标记，后续刷新仍由原 poller 触发，不另建调度器。
            const transcriptRequests = inFlightTranscriptsRef.current;
            if (!transcriptRequests.has(params.sessionId)) {
                const transcript = sync.refreshSessionMessages(params.sessionId).catch(() => {}).finally(() => {
                    transcriptRequests.delete(params.sessionId);
                });
                transcriptRequests.set(params.sessionId, transcript);
            }

            const statusResult = await statusPromise;
            // 先检查归属，过期请求无论成功或失败都不能改写新目标。
            if (viewerRef.current !== viewer || generationRef.current !== currentGeneration || !foregroundRef.current) {
                return null;
            }
            if (viewer.validUntilMs <= Date.now() || !statusResult.ok || !statusResult.response.ok) {
                // 连续显示旧活动摘要，但过期的能力与明确生命周期必须撤回。
                markUnavailable();
                return null;
            }
            const response = statusResult.response;

            if (!areDirectSessionRuntimeStatusesEqual(statusRef.current, response)) {
                statusRef.current = response;
                setStatus(response);
            }
            return statusRef.current;
        })().finally(() => {
            if (inFlightRefreshRef.current === refreshPromise) {
                inFlightRefreshRef.current = null;
            }
        });

        inFlightRefreshRef.current = refreshPromise;
        return refreshPromise;
    }, [activeServerId, attachViewer, directSessionLink, explicitServerId, markUnavailable, params.sessionId, releaseViewer, targetKey, viewerActive]);

    /** 关注只由 daemon 回复和回读决定；作废旧状态请求时保留当前 viewer 的身份和续租。 */
    const setNotificationsEnabled = React.useCallback(async (nextEnabled: boolean): Promise<boolean | null> => {
        if (!viewerActive || !foregroundRef.current || !committedViewerDemandRef.current?.active
            || committedViewerDemandRef.current.targetKey !== targetKey || !directSessionLink || inFlightFollowRef.current) return null;
        const currentGeneration = generationRef.current;
        setNotificationsBusy(true);
        let operation: Promise<boolean | null>;
        operation = (async () => {
            const fresh = await refreshNow();
            if (generationRef.current !== currentGeneration) return null;
            if (!fresh?.machineOnline || fresh.notifications?.capability !== 'explicit_lifecycle_v1') return false;
            try {
                const response = await machineDirectSessionFollowPolicySet({
                    machineId: directSessionLink.machineId,
                    sessionId: params.sessionId,
                    providerId: directSessionLink.providerId,
                    remoteSessionId: directSessionLink.remoteSessionId,
                    source: directSessionLink.source,
                    enabled: nextEnabled,
                }, { serverId: explicitServerId ?? resolvePreferredServerIdForSessionId(params.sessionId) ?? activeServerId });
                if (generationRef.current !== currentGeneration) return null;
                // 使写入前已发出的旧轮询失效，随后仍走同一个刷新入口。
                generationRef.current += 1;
                const readbackGeneration = generationRef.current;
                inFlightRefreshRef.current = null;
                if (response.ok && statusRef.current) {
                    const { notifications: _previousNotifications, ...current } = statusRef.current;
                    const next = { ...current, ...(response.notifications ? { notifications: response.notifications } : {}) };
                    if (!areDirectSessionRuntimeStatusesEqual(statusRef.current, next)) {
                        statusRef.current = next;
                        setStatus(next);
                    }
                }
                await refreshNow();
                if (generationRef.current !== readbackGeneration) return null;
                return response.ok;
            } catch {
                if (generationRef.current !== currentGeneration) return null;
                await refreshNow();
                return generationRef.current === currentGeneration ? false : null;
            }
        })().finally(() => {
            if (inFlightFollowRef.current === operation) {
                inFlightFollowRef.current = null;
                setNotificationsBusy(false);
            }
        });
        inFlightFollowRef.current = operation;
        return operation;
    }, [activeServerId, directSessionLink, explicitServerId, params.sessionId, refreshNow, targetKey, viewerActive]);

    // 卸载后迟到的探测或关注回复不能发布到其他会话。
    React.useLayoutEffect(() => () => {
        committedViewerDemandRef.current = null;
        releaseViewer();
    }, [releaseViewer]);

    React.useEffect(() => {
        if (!enabled) {
            if (statusRef.current !== null) {
                statusRef.current = null;
                setStatus(null);
            }
            return;
        }
        if (!directSessionLink) {
            if (statusRef.current !== null) {
                statusRef.current = null;
                setStatus(null);
            }
            return;
        }
        if (!viewerActive) return;

        let cancelled = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const scheduleNext = (nextStatus: DirectSessionRuntimeStatus | null) => {
            if (cancelled) return;
            timeoutId = setTimeout(() => {
                void runPoll();
            }, resolvePollDelayMs(nextStatus));
        };

        const runPoll = async () => {
            const nextStatus = await refreshNow().catch(() => statusRef.current);
            if (cancelled) return;
            scheduleNext(nextStatus);
        };

        void runPoll();

        return () => {
            cancelled = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [directSessionLink, enabled, refreshNow, viewerActive]);

    // 控制只跟随当前聚焦的原生桌面任务，观察事件触发快照刷新而不另起轮询器。
    const control = useDirectSessionControl({
        sessionId: params.sessionId,
        machineId: directSessionLink?.machineId ?? null,
        serverId: sessionServerId,
        enabled: viewerActive && directSessionLink?.providerId === 'codex' && status?.machineOnline === true && status.runnerActive !== true,
        observationKey: JSON.stringify(status?.observation ?? null),
    });

    return React.useMemo(() => ({
        control,
        directSessionLink,
        status,
        refreshNow,
        notificationsBusy,
        setNotificationsEnabled,
    }), [control, directSessionLink, refreshNow, status, notificationsBusy, setNotificationsEnabled]);
}
