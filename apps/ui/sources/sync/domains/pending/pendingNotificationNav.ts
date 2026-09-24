import { MMKV } from 'react-native-mmkv';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { serverAccountScopedStorageKey, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';
import { isPendingServerUrlActive, normalizePendingServerUrl } from './pendingServerScopedKeys';

export type NotificationTargetBinding = Readonly<{ accountId: string; machineId: string; notificationIdentity: string }>;

/** 只保留账号、电脑及来源摘要，不保存正文、审批动作或文件路径。 */
export function readNotificationTargetBinding(value: unknown): NotificationTargetBinding | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const fields = value as Record<string, unknown>;
    const accountId = typeof fields.accountId === 'string' ? fields.accountId.trim() : '';
    const machineId = typeof fields.machineId === 'string' ? fields.machineId.trim() : '';
    const notificationIdentity = typeof fields.notificationIdentity === 'string' ? fields.notificationIdentity : '';
    return accountId && machineId && /^[a-f0-9]{64}$/.test(notificationIdentity) ? { accountId, machineId, notificationIdentity } : null;
}

export type PendingNotificationNav = Readonly<{
    serverUrl: string;
    route: string;
    target?: NotificationTargetBinding;
}>;

const isWebRuntime = typeof window !== 'undefined' && typeof document !== 'undefined';
const scope = isWebRuntime ? null : readStorageScopeFromEnv();
const storage = new MMKV({ id: scopedStorageId('pending-notification-nav', scope) });

const KEY_RECORD_PREFIX = 'record:v2';
const KEY_AWAITING_AUTH = 'awaiting-auth:v1';
const KEY_SERVER_URL = 'serverUrl';
const KEY_ROUTE = 'route';

/** 规范服务地址，不能以服务器别名混淆待打开目标。 */
function normalizeUrl(raw: string): string {
    return normalizePendingServerUrl(raw) ?? '';
}

/** 旧无账号记录只供清理，不再自动认领给新登录账号。 */
function readLegacyPendingNotificationNav(): PendingNotificationNav | null {
    const serverUrl = storage.getString(KEY_SERVER_URL);
    const route = storage.getString(KEY_ROUTE);
    if (!serverUrl || !route) return null;
    return { serverUrl, route };
}

/** 删除旧版没有账号身份的临时导航记录。 */
function clearLegacyPendingNotificationNav(): void {
    storage.delete(KEY_SERVER_URL);
    storage.delete(KEY_ROUTE);
}

/** 读取时再次限制为会话定位，拒绝任意应用路由。 */
function readScopedPendingNotificationNav(key: string): PendingNotificationNav | null {
    const raw = storage.getString(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<PendingNotificationNav>;
        const serverUrl = normalizeUrl(parsed.serverUrl ?? '');
        const route = String(parsed.route ?? '').trim();
        const target = readNotificationTargetBinding(parsed.target);
        if (serverUrl && /^\/session\/[^/?#]+$/.test(route) && (!parsed.target || target)) {
            return { serverUrl, route, ...(target ? { target } : {}) };
        }
    } catch {
        // ignore corrupt scoped payload
    }
    storage.delete(key);
    return null;
}

/** 显式带账号的目标可在未登录时暂存；普通旧记录仍限制当前已登录作用域。 */
export function setPendingNotificationNav(value: PendingNotificationNav): void {
    const serverUrl = normalizeUrl(value?.serverUrl ?? '');
    const route = String(value?.route ?? '').trim();
    const target = readNotificationTargetBinding(value.target);
    if (!serverUrl || !/^\/session\/[^/?#]+$/.test(route) || (value.target && !target)) return;
    if (target) {
        storage.set(KEY_AWAITING_AUTH, JSON.stringify({ serverUrl, route, target }));
        return;
    }
    const activeScope = getActiveServerAccountScope();
    if (!activeScope || !isPendingServerUrlActive(serverUrl)) return;
    storage.set(
        serverAccountScopedStorageKey(KEY_RECORD_PREFIX, activeScope),
        JSON.stringify({ serverUrl, route } satisfies PendingNotificationNav),
    );
}

/** 只有原服务和原账号都匹配时才暴露暂存目标，换号绝不继承。 */
export function getPendingNotificationNav(): PendingNotificationNav | null {
    const activeScope = getActiveServerAccountScope();
    if (!activeScope) return null;
    const awaiting = readScopedPendingNotificationNav(KEY_AWAITING_AUTH);
    if (awaiting?.target && awaiting.target.accountId === activeScope.accountId && isPendingServerUrlActive(awaiting.serverUrl)) return awaiting;
    const key = serverAccountScopedStorageKey(KEY_RECORD_PREFIX, activeScope);
    const scoped = readScopedPendingNotificationNav(key);
    if (scoped) return scoped;

    const legacy = readLegacyPendingNotificationNav();
    if (!legacy) return null;
    clearLegacyPendingNotificationNav();
    return null;
}

/** 退出或新点击清掉单一受限目标，同时清当前账号旧格式记录。 */
export function clearPendingNotificationNav(): void {
    storage.delete(KEY_AWAITING_AUTH);
    const activeScope = getActiveServerAccountScope();
    if (activeScope) {
        storage.delete(serverAccountScopedStorageKey(KEY_RECORD_PREFIX, activeScope));
    }
    const legacy = readLegacyPendingNotificationNav();
    if (!legacy || isPendingServerUrlActive(legacy.serverUrl)) {
        clearLegacyPendingNotificationNav();
    }
}

/** 服务身份规范化只迁移同账号已隔离的旧记录。 */
export function migratePendingNotificationNavScopes(
    scope: ServerAccountScope,
    legacyScopes: readonly ServerAccountScope[],
): void {
    const canonicalKey = serverAccountScopedStorageKey(KEY_RECORD_PREFIX, scope);
    let hasCanonicalRecord = readScopedPendingNotificationNav(canonicalKey) !== null;
    for (const legacyScope of legacyScopes) {
        if (legacyScope.accountId !== scope.accountId || legacyScope.serverId === scope.serverId) continue;
        const legacyKey = serverAccountScopedStorageKey(KEY_RECORD_PREFIX, legacyScope);
        const legacyRecord = readScopedPendingNotificationNav(legacyKey);
        if (!hasCanonicalRecord && legacyRecord) {
            storage.set(canonicalKey, JSON.stringify(legacyRecord));
            hasCanonicalRecord = true;
        }
        storage.delete(legacyKey);
    }
}
