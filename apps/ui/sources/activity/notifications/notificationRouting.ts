import { isLoopbackHostname, PUSH_NOTIFICATION_ACTION_IDS } from '@happier-dev/protocol';

import { normalizeServerUrl } from '@/sync/domains/server/activeServerSwitch';
import { readNotificationTargetBinding, type NotificationTargetBinding } from '@/sync/domains/pending/pendingNotificationNav';
import { readDirectSessionLink } from '@/sync/domains/session/directSessions/readDirectSessionLink';

/** 解析通知定位字段；输入视为不可信数据，不赋予操作权限。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解析通知定位字段；输入视为不可信数据，不赋予操作权限。 */
export function isUnsafeNotificationServerUrl(serverUrl: string): boolean {
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized) return true;
    try {
        const url = new URL(normalized);
        const host = url.hostname.trim().toLowerCase();
        return url.protocol !== 'https:' || Boolean(url.username || url.password || url.search || url.hash) || isLoopbackHostname(host) || host === '0.0.0.0';
    } catch {
        return true;
    }
}

/** 解析通知定位字段；输入视为不可信数据，不赋予操作权限。 */
function extractServerUrlFromNotificationData(data: unknown): string | null {
    if (!isRecord(data)) return null;
    const serverUrl =
        typeof data.serverUrl === 'string'
            ? data.serverUrl
            : typeof data.server === 'string'
                ? data.server
                : '';
    const normalized = normalizeServerUrl(serverUrl);
    return normalized ? normalized : null;
}

/** 解析通知定位字段；输入视为不可信数据，不赋予操作权限。 */
function readSessionIdFromNotificationData(data: unknown): string {
    if (!isRecord(data)) return '';
    const raw = typeof data.sessionId === 'string' ? data.sessionId : '';
    return raw.trim();
}

/** 解析通知定位字段；输入视为不可信数据，不赋予操作权限。 */
function readNotificationActionIdentifier(params: Readonly<{
    response: unknown;
    defaultActionIdentifier: string;
}>): string {
    if (!isRecord(params.response)) return params.defaultActionIdentifier;
    const raw = typeof params.response.actionIdentifier === 'string' ? params.response.actionIdentifier : '';
    return raw.trim() || params.defaultActionIdentifier;
}

/** 解析通知定位字段；输入视为不可信数据，不赋予操作权限。 */
function readNotificationId(params: Readonly<{ response: unknown }>): string | null {
    if (!isRecord(params.response)) return null;
    const notification = (params.response as any).notification;
    const identifier = notification?.request?.identifier;
    const raw = typeof identifier === 'string' ? identifier : '';
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
}

/** 解析通知定位字段；输入视为不可信数据，不赋予操作权限。 */
function readNotificationData(params: Readonly<{ response: unknown }>): unknown {
    if (!isRecord(params.response)) return null;
    const notification = (params.response as any).notification;
    return notification?.request?.content?.data;
}

export type ParsedNotificationTap = Readonly<{
    dedupeKey: string | null;
    actionIdentifier: string;
    isDefaultTap: boolean;
    isOpenAction: boolean;
    openOnly: boolean;
    target: NotificationTargetBinding | null;
    route: string | null;
    serverUrl: string | null;
    permissionAction: Readonly<{ action: 'allow' | 'deny'; sessionId: string; requestId: string }> | null;
}>;

/** 解析通知定位字段；输入视为不可信数据，不赋予操作权限。 */
export function parseNotificationTap(params: Readonly<{
    response: unknown;
    defaultActionIdentifier: string;
}>): ParsedNotificationTap | null {
    const actionIdentifier = readNotificationActionIdentifier(params);
    const isDefaultTap = actionIdentifier === params.defaultActionIdentifier;
    const permissionAction =
        actionIdentifier === PUSH_NOTIFICATION_ACTION_IDS.permissionAllowV1
            ? ('allow' as const)
            : actionIdentifier === PUSH_NOTIFICATION_ACTION_IDS.permissionDenyV1
                ? ('deny' as const)
                : null;

    const data = readNotificationData({ response: params.response });
    // 桌面请求没有本地审批权限；即使系统恢复了旧动作，也只进入已关联会话。
    const openOnly = isRecord(data) && data.interaction === 'open_only';
    const isOpenAction = isDefaultTap || actionIdentifier === PUSH_NOTIFICATION_ACTION_IDS.userActionOpenV1
        || permissionAction !== null;
    const isKnownActionIdentifier = isOpenAction || permissionAction !== null;
    if (!isKnownActionIdentifier) return null;

    const serverUrl = extractServerUrlFromNotificationData(data);

    const sessionId = readSessionIdFromNotificationData(data);
    if (openOnly && (!serverUrl || !sessionId)) return null;
    const route = sessionId ? `/session/${encodeURIComponent(sessionId)}` : null;
    // 系统遗留审批按钮一律只打开详情；不接受或保存可执行审批动作。
    const target = readNotificationTargetBinding(data);
    const notificationId = readNotificationId({ response: params.response });
    const dedupeKey = notificationId ? `${notificationId}:${actionIdentifier}` : null;

    return {
        dedupeKey,
        actionIdentifier,
        isDefaultTap,
        isOpenAction,
        openOnly,
        route,
        serverUrl,
        permissionAction: null,
        target,
    };
}

/** 新鲜会话元数据的身份摘要已绑定服务、账号、电脑、来源和原线程，不能只相信推送字段。 */
export function matchesNotificationSessionTarget(target: NotificationTargetBinding, metadata: unknown): boolean {
    const link = readDirectSessionLink(metadata);
    if (!link || link.machineId !== target.machineId) return false;
    const state = link.notificationStateV1;
    return isRecord(state) && state.identity === target.notificationIdentity;
}
