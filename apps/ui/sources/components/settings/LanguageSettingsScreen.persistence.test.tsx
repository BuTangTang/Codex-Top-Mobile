import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView } from '@/dev/testkit';
import type { AccountSettingsScope } from '@/sync/domains/settings/scope/accountSettingsScope';
import type { Settings } from '@/sync/domains/settings/settings';

const boundaries = vi.hoisted(() => ({
    reload: vi.fn(async () => {}),
    interactions: [] as Array<() => void>,
}));

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'android' }, {
        InteractionManager: {
            runAfterInteractions: (callback: () => void) => {
                boundaries.interactions.push(callback);
                return { cancel: () => {} };
            },
        },
    });
});
vi.mock('expo-updates', () => ({
    useUpdates: () => ({}),
    reloadAsync: boundaries.reload,
}));
vi.mock('expo-localization', () => ({
    getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }],
}));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ confirmResult: true }).module;
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});
// Vitest 的 ESM 加载器不处理原生运行时的 require 桥；仍返回真实 Sync 单例。
vi.mock('@/sync/runtime/getSyncSingleton', () => ({ getSyncSingleton: () => sync }));
vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: {
        request: vi.fn(), emitWithAck: vi.fn(), send: vi.fn(), onMessage: vi.fn(),
        onStatusChange: vi.fn(), onReconnected: vi.fn(), disconnect: vi.fn(), initialize: vi.fn(),
    },
}));
vi.mock('@/utils/system/runtimeFetch', () => ({ runtimeFetch: vi.fn() }));
vi.mock('@/log', () => ({ log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import LanguageSettingsScreen from '@/app/(app)/settings/language';
import { storage } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { loadPendingAccountSettings } from '@/sync/domains/state/accountSettingsPersistence';
import { setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { t } from '@/text';

const initialState = storage.getState();
const internals = sync as unknown as {
    activateAccountSettingsScope: (accountId: string) => AccountSettingsScope;
    clearActiveAccountSettingsScope: () => void;
    pendingSettings: Partial<Settings>;
};

describe('Chinese-only language entry and saved settings', () => {
    let scope: AccountSettingsScope;

    /** 使用真实账号设置和持久化入口，系统重启与网络保持隔离。 */
    beforeEach(() => {
        vi.useFakeTimers();
        boundaries.reload.mockReset().mockResolvedValue(undefined);
        boundaries.interactions.length = 0;
        sync.disconnectServer();
        storage.setState(initialState, true);
        const server = upsertServerProfile({ serverUrl: 'https://language-settings.example', name: 'Language test' });
        setActiveServerId(server.id, { scope: 'device' });
        scope = internals.activateAccountSettingsScope('language-account');
    });

    /** 清理隔离账号与计时器，不写入真实账号。 */
    afterEach(async () => {
        vi.restoreAllMocks();
        vi.clearAllTimers();
        await act(async () => { internals.clearActiveAccountSettingsScope(); });
        vi.useRealTimers();
    });

    /** 真实持久化的英文偏好可恢复，但不能再改变产品显示语言。 */
    it('keeps Chinese after restoring an existing English account preference', () => {
        storage.getState().applySettingsLocal({ preferredLanguage: 'en' });
        expect(t('common.error')).toBe('错误');
        internals.clearActiveAccountSettingsScope();
        storage.setState(initialState, true);
        internals.activateAccountSettingsScope(scope.accountId);
        expect(storage.getState().settings.preferredLanguage).toBe('en');
        expect(t('common.error')).toBe('错误');
        expect(loadPendingAccountSettings(scope)).toEqual({});
    });

    /** 旧语言页深链只返回外观设置，不写设置、不触发重启。 */
    it('redirects the old language route without changing settings or restarting', async () => {
        storage.getState().applySettingsLocal({ preferredLanguage: 'en' });
        const screen = await renderSettingsView(<LanguageSettingsScreen />);
        expect(screen.findAllByType('Redirect')[0]?.props.href).toBe('/settings/appearance');
        expect(screen.findRowByTitle('English')).toBeNull();
        expect(storage.getState().settings.preferredLanguage).toBe('en');
        expect(loadPendingAccountSettings(scope)).toEqual({});
        expect(boundaries.reload).not.toHaveBeenCalled();
    });

    /** 原有普通设置继续使用原生防抖及交互后持久化，不受语言限制影响。 */
    it('leaves ordinary settings on the existing native debounce and interaction boundary', async () => {
        sync.applySettings({ viewInline: !storage.getState().settings.viewInline });
        const expected = { viewInline: storage.getState().settings.viewInline };
        await vi.advanceTimersByTimeAsync(899);
        expect(loadPendingAccountSettings(scope)).toEqual({});
        await vi.advanceTimersByTimeAsync(1);
        expect(loadPendingAccountSettings(scope)).toEqual({});
        expect(boundaries.interactions).toHaveLength(1);
        boundaries.interactions.shift()!();
        expect(loadPendingAccountSettings(scope)).toEqual(expected);
    });
});
