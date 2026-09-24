import { router } from 'expo-router';
import * as React from 'react';
import { Platform } from 'react-native';
import { getCurrentAuth } from '@/auth/context/AuthContext';
import { Modal } from '@/modal';
import { t } from '@/text';
import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import { getActiveServerSnapshot, listServerProfiles } from '@/sync/domains/server/serverProfiles';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { storage, useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { clearPendingNotificationNav, getPendingNotificationNav, setPendingNotificationNav, type PendingNotificationNav } from '@/sync/domains/pending/pendingNotificationNav';
import { clearPendingNotificationAction } from '@/sync/domains/pending/pendingNotificationAction';
import { loadExpoNotifications, type ExpoNotificationsModule } from '@/utils/platform/loadExpoNotifications';
import { navigateToSessionRoute } from '@/hooks/session/navigateToSessionRoute';
import { isUnsafeNotificationServerUrl, matchesNotificationSessionTarget, parseNotificationTap } from '../notificationRouting';

type ExpoNotificationsWithClear = ExpoNotificationsModule & Readonly<{ clearLastNotificationResponseAsync?: () => Promise<void> }>;

/** 只选择已有服务配置，推送不能自动创建可信服务器或接管登录。 */
function findSavedServerProfileForUrl(serverUrl: string): { id: string; serverUrl: string } | null {
    const key = createServerUrlComparableKey(serverUrl);
    return listServerProfiles().find((profile) => createServerUrlComparableKey(profile.serverUrl) === key) ?? null;
}

/** 未登录也接收受限目标；登录后校验原账号和真实来源，通知从不执行审批动作。 */
export function useNotificationResponseRouting(params: Readonly<{ enabled: boolean; refreshAuth: () => Promise<void> }>): void {
    const accountScope = useActiveServerAccountScope();
    const handled = React.useRef(new Set<string>());
    const generation = React.useRef(0);
    const refreshAuthRef = React.useRef(params.refreshAuth);
    refreshAuthRef.current = params.refreshAuth;

    React.useEffect(() => {
        if (Platform.OS === 'web') return;
        let disposed = false;
        let subscription: { remove: () => void } | null = null;
        const effectGeneration = ++generation.current;
        // 旧版持久审批意图一律作废，不能在登录恢复时重放。
        clearPendingNotificationAction();
        /** 无法确认来源时停留当前页面，使用现有明确不可访问提示。 */
        const unavailable = () => Modal.alert(t('common.error'), t('errors.sessionNotFound'));
        /** 等待权威元数据后再次检查账号、服务器代次和最新点击，迟到结果不得导航。 */
        const openPending = async (pending: PendingNotificationNav, requestGeneration: number, dedupeKey: string | null = null): Promise<void> => {
            const target = pending.target;
            const before = getActiveServerSnapshot();
            const scope = getActiveServerAccountScope();
            if (!target || !getCurrentAuth()?.isAuthenticated || !scope || scope.accountId !== target.accountId
                || createServerUrlComparableKey(before.serverUrl) !== createServerUrlComparableKey(pending.serverUrl)) return;
            const sessionId = decodeURIComponent(pending.route.slice('/session/'.length));
            /** 每个异步边界使用实时账号事实，而不是 effect 闭包里的旧登录值。 */
            const isCurrent = () => !disposed && requestGeneration === generation.current && getCurrentAuth()?.isAuthenticated === true
                && getActiveServerSnapshot().generation === before.generation
                && getActiveServerAccountScope()?.accountId === target.accountId;
            try {
                const { sync } = await import('@/sync/sync');
                if (!isCurrent()) return;
                const result = await sync.ensureSessionVisibleForMessageRoute(sessionId, { serverId: before.serverId, forceRefresh: true });
                if (!isCurrent()) return;
                if (result.kind !== 'available') { unavailable(); return; }
                const session = storage.getState().sessions[sessionId];
                if (!matchesNotificationSessionTarget(target, session?.metadata)) { clearPendingNotificationNav(); unavailable(); return; }
                clearPendingNotificationNav();
                // 仅成功核验并打开后去重；离线失败保留用户再次点击重试的机会。
                if (dedupeKey) handled.current.add(dedupeKey);
                navigateToSessionRoute({ router, sessionId, serverId: before.serverId, refreshAuth: refreshAuthRef.current });
            } catch {
                if (isCurrent()) unavailable();
                // 网络失败保留无正文定位，后续点击或重新登录可再核验。
            }
        };
        const pending = params.enabled ? getPendingNotificationNav() : null;
        if (pending?.target) void openPending(pending, effectGeneration);

        /** 先保存单一受限目标；其他账号既不能消费，也不能用同名任务缓存代替。 */
        const receive = (response: unknown, defaultActionIdentifier: string, coldStart = false): void => {
            if (disposed || (coldStart && generation.current !== effectGeneration)) return;
            const parsed = parseNotificationTap({ response, defaultActionIdentifier });
            if (!parsed?.isOpenAction || !parsed.route) return;
            if (parsed.dedupeKey && handled.current.has(parsed.dedupeKey)) return;
            const requestGeneration = ++generation.current;
            if (!parsed.target || !parsed.serverUrl || isUnsafeNotificationServerUrl(parsed.serverUrl)) { unavailable(); return; }
            const pendingTarget = { serverUrl: parsed.serverUrl, route: parsed.route, target: parsed.target };
            setPendingNotificationNav(pendingTarget);
            const saved = findSavedServerProfileForUrl(parsed.serverUrl);
            if (!saved) {
                router.push(`/settings/server?url=${encodeURIComponent(parsed.serverUrl)}&source=notification`);
                return;
            }
            const active = getActiveServerSnapshot();
            if (createServerUrlComparableKey(active.serverUrl) !== createServerUrlComparableKey(saved.serverUrl)) {
                // 原切服 owner 加载该服务器凭据，账号 scope 更新后由上面的单一恢复路径消费。
                void setActiveServerAndSwitch({ serverId: saved.id, scope: 'device', refreshAuth: refreshAuthRef.current })
                    .catch(() => { if (!disposed && requestGeneration === generation.current) unavailable(); });
                return;
            }
            if (!getCurrentAuth()?.isAuthenticated) { router.navigate('/'); return; }
            if (getActiveServerAccountScope()?.accountId !== parsed.target.accountId) { unavailable(); return; }
            void openPending(pendingTarget, requestGeneration, parsed.dedupeKey);
        };
        void loadExpoNotifications().then((notifications) => {
            if (disposed) return;
            void notifications.getLastNotificationResponseAsync().then(async (response) => {
                if (!response || disposed) return;
                receive(response, notifications.DEFAULT_ACTION_IDENTIFIER, true);
                await (notifications as ExpoNotificationsWithClear).clearLastNotificationResponseAsync?.();
            }).catch(() => {});
            subscription = notifications.addNotificationResponseReceivedListener((response) => receive(response, notifications.DEFAULT_ACTION_IDENTIFIER));
        }).catch(() => {});
        return () => { disposed = true; generation.current += 1; subscription?.remove(); };
    }, [params.enabled, accountScope?.serverId, accountScope?.accountId]);
}
