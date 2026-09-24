import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';

const isWebRuntime = typeof window !== 'undefined' && typeof document !== 'undefined';

type MmkvStorage = import('react-native-mmkv').MMKV;

let storage: MmkvStorage | null = null;

function getStorage(): MmkvStorage {
    if (storage) return storage;
    if (isWebRuntime) {
        throw new Error('MMKV storage is not available on web runtime');
    }
    const mmkvModule = require('react-native-mmkv') as typeof import('react-native-mmkv');
    const scope = readStorageScopeFromEnv();
    storage = new mmkvModule.MMKV({ id: scopedStorageId('push-token-registration', scope) });
    return storage;
}

const KEY_LAST_EXPO_PUSH_TOKEN = 'lastExpoPushTokenV1';
const LOCAL_STORAGE_KEY_LAST_EXPO_PUSH_TOKEN = `${scopedStorageId('push-token-registration', null)}:${KEY_LAST_EXPO_PUSH_TOKEN}`;

function safeLocalStorageGetString(key: string): string | null {
    try {
        return typeof window?.localStorage?.getItem === 'function' ? window.localStorage.getItem(key) : null;
    } catch {
        return null;
    }
}

function safeLocalStorageSetString(key: string, value: string): void {
    try {
        if (typeof window?.localStorage?.setItem === 'function') {
            window.localStorage.setItem(key, value);
        }
    } catch {
        // ignore
    }
}

function safeLocalStorageDelete(key: string): void {
    try {
        if (typeof window?.localStorage?.removeItem === 'function') {
            window.localStorage.removeItem(key);
        }
    } catch {
        // ignore
    }
}

export function loadLastRegisteredExpoPushToken(): string | null {
    if (isWebRuntime) {
        return safeLocalStorageGetString(LOCAL_STORAGE_KEY_LAST_EXPO_PUSH_TOKEN);
    }
    return getStorage().getString(KEY_LAST_EXPO_PUSH_TOKEN) ?? null;
}

export function saveLastRegisteredExpoPushToken(token: string): void {
    const value = String(token ?? '').trim();
    if (!value) return;
    if (isWebRuntime) {
        safeLocalStorageSetString(LOCAL_STORAGE_KEY_LAST_EXPO_PUSH_TOKEN, value);
        return;
    }
    getStorage().set(KEY_LAST_EXPO_PUSH_TOKEN, value);
}

export function clearLastRegisteredExpoPushToken(): void {
    if (isWebRuntime) {
        safeLocalStorageDelete(LOCAL_STORAGE_KEY_LAST_EXPO_PUSH_TOKEN);
        return;
    }
    getStorage().delete(KEY_LAST_EXPO_PUSH_TOKEN);
}

export type PendingExpoPushUnregistration = Readonly<{ serverUrl: string; accountId: string; token: string }>;
const KEY_PENDING_UNREGISTRATIONS = 'pendingUnregistrationsV1';
const WEB_PENDING_UNREGISTRATIONS = `${scopedStorageId('push-token-registration', null)}:${KEY_PENDING_UNREGISTRATIONS}`;

/** 退出后的远端解绑状态沿原注册 owner 保存，不保存 JWT、密码或种子。 */
export function loadPendingExpoPushUnregistrations(): PendingExpoPushUnregistration[] {
    try {
        const raw = isWebRuntime ? safeLocalStorageGetString(WEB_PENDING_UNREGISTRATIONS) : getStorage().getString(KEY_PENDING_UNREGISTRATIONS);
        const value: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(value) ? value.filter((row): row is PendingExpoPushUnregistration => Boolean(row && typeof row.serverUrl === 'string' && typeof row.accountId === 'string' && typeof row.token === 'string')) : [];
    } catch { return []; }
}

/** 只记录待核对的设备 token 归属，重复退出不重复添加。 */
export function savePendingExpoPushUnregistration(record: PendingExpoPushUnregistration): void {
    const current = loadPendingExpoPushUnregistrations().filter((row) => row.serverUrl !== record.serverUrl || row.accountId !== record.accountId || row.token !== record.token);
    const raw = JSON.stringify([...current, record]);
    if (isWebRuntime) safeLocalStorageSetString(WEB_PENDING_UNREGISTRATIONS, raw);
    else getStorage().set(KEY_PENDING_UNREGISTRATIONS, raw);
}

/** 仅在远端已确认删除，或同服务已确认转交此设备 token 后清除对应待办。 */
export function clearPendingExpoPushUnregistration(record: PendingExpoPushUnregistration): void {
    const raw = JSON.stringify(loadPendingExpoPushUnregistrations().filter((row) => row.serverUrl !== record.serverUrl || row.accountId !== record.accountId || row.token !== record.token));
    if (isWebRuntime) safeLocalStorageSetString(WEB_PENDING_UNREGISTRATIONS, raw);
    else getStorage().set(KEY_PENDING_UNREGISTRATIONS, raw);
}
