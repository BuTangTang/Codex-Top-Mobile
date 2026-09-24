import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveLastRegisteredExpoPushToken, loadLastRegisteredExpoPushToken, loadPendingExpoPushUnregistrations, clearPendingExpoPushUnregistration } from '@/sync/domains/state/pushTokenRegistration';
const boundary = vi.hoisted(() => ({ remove: vi.fn(), register: vi.fn(), mint: vi.fn(), permission: vi.fn() }));
// 原生存储是系统边界；保留真实 TokenStorage 的服务器选择和凭据读取逻辑。
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
vi.mock('@/sync/api/session/apiPush', () => ({ deletePushToken: boundary.remove, registerPushToken: boundary.register }));
vi.mock('@/activity/notifications/permission/pushNotificationAccess', () => ({ readExpoPushToken: boundary.mint, readPushPermission: boundary.permission }));
const credentials = { token: `hdr.${Buffer.from(JSON.stringify({ sub: 'old-account' })).toString('base64')}.sig`, secret: 'synthetic' };
beforeEach(() => {
    vi.clearAllMocks();
    for (const record of loadPendingExpoPushUnregistrations()) clearPendingExpoPushUnregistration(record);
    saveLastRegisteredExpoPushToken('ExponentPushToken[device]');
});
describe('push logout ownership', () => {
    it('clears local registration immediately and records offline removal without minting a new token', async () => {
        boundary.remove.mockRejectedValue(new Error('offline'));
        const { unregisterPushTokenOnLogout } = await import('./syncAccount');
        const result = unregisterPushTokenOnLogout({ credentials, serverUrl: 'https://owner.test' });
        expect(loadLastRegisteredExpoPushToken()).toBeNull();
        expect(loadPendingExpoPushUnregistrations()).toEqual([{ serverUrl: 'https://owner.test', accountId: 'old-account', token: 'ExponentPushToken[device]' }]);
        expect(await result).toBe('pending');
        expect(boundary.mint).not.toHaveBeenCalled();
    });
    it('removes the pending marker only after the old-account endpoint confirms deletion', async () => {
        boundary.remove.mockResolvedValue(undefined);
        const { unregisterPushTokenOnLogout } = await import('./syncAccount');
        expect(await unregisterPushTokenOnLogout({ credentials, serverUrl: 'https://owner.test' })).toBe('removed');
        expect(loadPendingExpoPushUnregistrations()).toEqual([]);
        expect(boundary.remove.mock.calls[0][0]).toBe(credentials);
        expect(boundary.remove.mock.calls[0][2].apiEndpoint).toBe('https://owner.test');
    });
    it('serializes a delayed old registration, its logout, and the new account registration', async () => {
        const { Platform } = await import('react-native');
        Platform.OS = 'android';
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'https://owner.test', scope: 'device' });
        const { registerPushTokenIfAvailable, unregisterPushTokenOnLogout } = await import('./syncAccount');
        boundary.permission.mockResolvedValue({ ok: true, permission: { granted: true } });
        boundary.mint.mockResolvedValue({ ok: true, token: 'ExponentPushToken[device]' });
        let release!: () => void;
        boundary.register.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
        boundary.remove.mockResolvedValue(undefined);
        const oldRegistration = registerPushTokenIfAvailable({ credentials, log: { log: () => {} } });
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        const removal = unregisterPushTokenOnLogout({ credentials, serverUrl: 'https://owner.test' });
        const newCredentials = { ...credentials, token: `hdr.${Buffer.from(JSON.stringify({ sub: 'new-account' })).toString('base64')}.sig` };
        const newRegistration = registerPushTokenIfAvailable({ credentials: newCredentials, log: { log: () => {} } });
        expect(loadLastRegisteredExpoPushToken()).toBeNull();
        expect(boundary.remove).not.toHaveBeenCalled();
        release();
        await Promise.all([oldRegistration, removal, newRegistration]);
        expect(boundary.remove.mock.calls[0][0]).toEqual(credentials);
        expect(boundary.register.mock.calls.at(-1)?.[0]).toEqual(newCredentials);
        expect(loadLastRegisteredExpoPushToken()).toBe('ExponentPushToken[device]');
        expect(loadPendingExpoPushUnregistrations()).toEqual([]);
    });
});
