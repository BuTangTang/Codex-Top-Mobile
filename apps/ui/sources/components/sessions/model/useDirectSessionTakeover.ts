import * as React from 'react';

import { showDirectSessionTakeoverDialog } from '@/components/sessions/directSessions/takeover/showDirectSessionTakeoverDialog';
import { resolveDirectSessionControlNotice } from '@/components/sessions/directSessions/resolveDirectSessionControlNotice';
import { Modal } from '@/modal';
import type { UseDirectSessionRuntimeResult } from '@/components/sessions/model/useDirectSessionRuntime';
import { machineDirectSessionTakeover, machineDirectSessionTakeoverPersist } from '@/sync/ops/machineDirectSessions';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { sync } from '@/sync/sync';
import { t } from '@/text';

type DirectTakeoverMode = 'direct' | 'persisted';

type UseDirectSessionTakeoverParams = Readonly<{
    sessionId: string;
    hasWriteAccess: boolean;
    inheritsDesktopSettings?: boolean;
    directSessionRuntime: Pick<UseDirectSessionRuntimeResult, 'directSessionLink' | 'status' | 'refreshNow'>;
}>;

type UseDirectSessionTakeoverResult = Readonly<{
    takeoverInFlight: DirectTakeoverMode | null;
    requestTakeover: (mode: DirectTakeoverMode, options?: Readonly<{ forceStop?: boolean; promptForForceStop?: boolean }>) => Promise<boolean>;
    ensureReadyForSend: (options?: Readonly<{ intent: 'text' }>) => Promise<boolean | 'external'>;
}>;

function resolveServerId(sessionId: string): string | undefined {
    return resolvePreferredServerIdForSessionId(sessionId);
}

// 保留原有 runner 和显式接管入口，只对明确的文本发送开放外部桌面能力。
export function useDirectSessionTakeover(params: UseDirectSessionTakeoverParams): UseDirectSessionTakeoverResult {
    // 外层会话壳可跨路由复用；每次会话切换创建独立作用域，旧请求仍绑定原目标。
    const scope = React.useMemo(() => ({ busy: false }), [params.sessionId]);
    const currentScope = React.useRef<typeof scope | null>(scope);
    currentScope.current = scope;
    const [progress, setProgress] = React.useState<{ scope: typeof scope; mode: DirectTakeoverMode } | null>(null);
    const takeoverInFlight = progress?.scope === scope ? progress.mode : null;
    React.useEffect(() => {
        currentScope.current = scope;
        return () => { if (currentScope.current === scope) currentScope.current = null; };
    }, [scope]);

    const readLatestStatus = React.useCallback(async () => {
        return await params.directSessionRuntime.refreshNow();
    }, [params.directSessionRuntime]);

    // 菜单与发送路径共用此 owner；从 fresh status 开始去重，异步结果只更新所属会话。
    const requestTakeover = React.useCallback(async (
        mode: DirectTakeoverMode,
        options?: Readonly<{ forceStop?: boolean; promptForForceStop?: boolean }>,
    ): Promise<boolean> => {
        if (currentScope.current !== scope || scope.busy) return false;
        if (!params.hasWriteAccess) {
            Modal.alert(t('common.error'), t('session.sharing.noEditPermission'));
            return false;
        }
        const directSessionLink = params.directSessionRuntime.directSessionLink;
        if (!directSessionLink) return false;

        scope.busy = true;
        try {
            const latestStatus = await readLatestStatus();
            if (currentScope.current !== scope || !latestStatus) return false;
            if (!latestStatus.machineOnline) {
                Modal.alert(t('common.error'), t('chatFooter.directSessionMachineOffline'));
                return false;
            }

            let forceStop = options?.forceStop === true;
            if (!forceStop && latestStatus.canForceStop && options?.promptForForceStop !== false) {
                const confirmed = await Modal.confirm(
                    t('chatFooter.directTakeoverForceStopConfirmTitle'),
                    t('chatFooter.directTakeoverForceStopConfirmBody'),
                    {
                        confirmText: t('chatFooter.directTakeoverForceStopConfirmAction'),
                        cancelText: t('common.cancel'),
                    },
                );
                if (currentScope.current !== scope || !confirmed) return false;
                forceStop = true;
            }

            setProgress({ scope, mode });
            const request = {
                machineId: directSessionLink.machineId,
                sessionId: params.sessionId,
                ...(forceStop ? { forceStop: true } : {}),
            };
            const serverId = resolveServerId(params.sessionId);
            const result = mode === 'persisted'
                ? await machineDirectSessionTakeoverPersist(request, { serverId })
                : await machineDirectSessionTakeover(request, { serverId });

            // 已发送的操作不改目标、不重发；离开该会话后也不刷新或清理新会话。
            if (currentScope.current !== scope) return false;
            if (!result.ok) {
                Modal.alert(t('common.error'), result.error);
                return false;
            }
            await Promise.all([
                params.directSessionRuntime.refreshNow(),
                sync.refreshSessionMessages(params.sessionId),
                mode === 'persisted' ? sync.refreshSessions() : Promise.resolve(),
            ]);
            return currentScope.current === scope;
        } catch (error) {
            if (currentScope.current === scope) {
                Modal.alert(t('common.error'), error instanceof Error ? error.message : t('errors.failedToSwitchControl'));
            }
            return false;
        } finally {
            scope.busy = false;
            if (currentScope.current === scope) setProgress(null);
        }
    }, [params.directSessionRuntime, params.hasWriteAccess, params.sessionId, readLatestStatus, scope]);

    // 返回本次探测选择的路径，调用者无需再读取可能陈旧的 React 状态决定发送方式。
    const ensureReadyForSend = React.useCallback(async (
        options?: Readonly<{ intent: 'text' }>,
    ): Promise<boolean | 'external'> => {
        const directSessionLink = params.directSessionRuntime.directSessionLink;
        if (!directSessionLink) {
            return true;
        }

        const isTextIntent = options?.intent === 'text';
        if (isTextIntent && !params.hasWriteAccess) {
            Modal.alert(t('common.error'), t('session.sharing.noEditPermission'));
            return false;
        }

        const latestStatus = await readLatestStatus();
        if (!latestStatus) {
            // 探测未成功时说明本次没有发送，保留原草稿，不用缓存解释拒绝原因。
            if (isTextIntent) {
                Modal.alert(t('errors.failedToSendMessage'), `${resolveDirectSessionControlNotice(null, params.inheritsDesktopSettings === true)}\n\n${t('chatFooter.directSessionDraftKept')}`);
            }
            return !isTextIntent;
        }
        if (latestStatus.runnerActive) {
            return true;
        }
        if (!latestStatus.machineOnline) {
            Modal.alert(t('common.error'), t('chatFooter.directSessionMachineOffline'));
            return false;
        }

        if (isTextIntent) {
            if (latestStatus.externalControl?.canSend === true) return 'external';
            // 能力撤回或缺失必须可见，且不能通过接管改变用户原本的发送意图。
            Modal.alert(t('errors.failedToSendMessage'), `${resolveDirectSessionControlNotice(latestStatus, params.inheritsDesktopSettings === true)}\n\n${t('chatFooter.directSessionDraftKept')}`);
            return false;
        }

        const resolution = await showDirectSessionTakeoverDialog({
            canTakeOverDirect: latestStatus.canTakeOverDirect,
            canTakeOverPersist: latestStatus.canTakeOverPersist,
            canForceStop: latestStatus.canForceStop,
        });
        if (!resolution.action) {
            return false;
        }

        return requestTakeover(resolution.action, {
            forceStop: resolution.forceStop,
            promptForForceStop: false,
        });
    }, [params.directSessionRuntime, params.hasWriteAccess, params.inheritsDesktopSettings, readLatestStatus, requestTakeover]);

    return React.useMemo(() => ({
        takeoverInFlight,
        requestTakeover,
        ensureReadyForSend,
    }), [takeoverInFlight, requestTakeover, ensureReadyForSend]);
}
