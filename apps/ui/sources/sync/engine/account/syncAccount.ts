import { parseToken } from '@/utils/auth/parseToken';
import { Platform } from 'react-native';

import { deletePushToken as deletePushTokenApi, registerPushToken as registerPushTokenApi } from '@/sync/api/session/apiPush';
import type { Encryption } from '@/sync/encryption/encryption';
import type { Profile } from '@/sync/domains/profiles/profile';
import { profileParse } from '@/sync/domains/profiles/profile';
import {
    applySettings as applySettingsDelta,
    settingsParse,
    SUPPORTED_SCHEMA_VERSION,
    type Settings,
} from '@/sync/domains/settings/settings';
import {
    pickLocalOnlyAccountSettings,
    stripLocalOnlyAccountSettings,
} from '@/sync/domains/settings/localOnlyAccountSettings';
import type { AccountSettingsScope } from '@/sync/domains/settings/scope/accountSettingsScope';
import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { HappyError } from '@/utils/errors/errors';
import { listServerProfiles } from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { serverFetch } from '@/sync/http/client';
import { openAccountScopedBlobCiphertext } from '@happier-dev/protocol';
import { deriveSettingsSecretsKey, sealSecretsDeep } from '@/sync/encryption/secretSettings';
import { loadLastRegisteredExpoPushToken, saveLastRegisteredExpoPushToken, clearLastRegisteredExpoPushToken, loadPendingExpoPushUnregistrations, savePendingExpoPushUnregistration, clearPendingExpoPushUnregistration } from '@/sync/domains/state/pushTokenRegistration';
import { isExpoPushNotificationChannelEnabled } from '@happier-dev/protocol';
import { readExpoPushToken, readPushPermission } from '@/activity/notifications/permission/pushNotificationAccess';

export async function handleUpdateAccountSocketUpdate(params: {
    accountUpdate: any;
    updateCreatedAt: number;
    currentProfile: Profile;
    encryption: Encryption;
    settingsScope?: AccountSettingsScope | null;
    applyProfile: (profile: Profile) => void;
    applySettings: (settings: any, version: number) => void;
    applySettingsForScope?: (scope: AccountSettingsScope, settings: any, version: number) => void;
    getLocalSettings?: () => unknown;
    getPendingSettings?: () => Partial<Settings>;
    log: { log: (message: string) => void };
}): Promise<void> {
    const {
        accountUpdate,
        updateCreatedAt,
        currentProfile,
        encryption,
        settingsScope,
        applyProfile,
        applySettings,
        applySettingsForScope,
        getLocalSettings,
        getPendingSettings,
        log,
    } = params;

    const applyMergedSettings = (settings: any, version: number): void => {
        if (settingsScope && applySettingsForScope) {
            applySettingsForScope(settingsScope, settings, version);
            return;
        }
        applySettings(settings, version);
    };

    // Build updated profile with new data
    const updatedProfile: Profile = {
        ...currentProfile,
        firstName: accountUpdate.firstName !== undefined ? accountUpdate.firstName : currentProfile.firstName,
        lastName: accountUpdate.lastName !== undefined ? accountUpdate.lastName : currentProfile.lastName,
        username: accountUpdate.username !== undefined ? accountUpdate.username : currentProfile.username,
        avatar: accountUpdate.avatar !== undefined ? accountUpdate.avatar : currentProfile.avatar,
        linkedProviders:
            accountUpdate.linkedProviders !== undefined ? accountUpdate.linkedProviders : currentProfile.linkedProviders,
        connectedServices:
            accountUpdate.connectedServices !== undefined
                ? accountUpdate.connectedServices
                : currentProfile.connectedServices,
        connectedServicesV2:
            accountUpdate.connectedServicesV2 !== undefined
                ? accountUpdate.connectedServicesV2
                : currentProfile.connectedServicesV2,
        timestamp: updateCreatedAt, // Update timestamp to latest
    };

    // Apply the updated profile to storage
    applyProfile(updatedProfile);

    // Handle settings updates (new for profile sync)
    if (accountUpdate.settingsV2?.content || accountUpdate.settingsV2?.content === null) {
        try {
            const version = Number(accountUpdate.settingsV2?.version ?? 0);
            const content = accountUpdate.settingsV2?.content;
            let decryptedSettings: unknown = null;

            if (!content) {
                decryptedSettings = null;
            } else if (content.t === 'plain') {
                decryptedSettings = content.v;
            } else if (content.t === 'encrypted') {
                const machineKey = encryption.getContentPrivateKey();
                const opened = openAccountScopedBlobCiphertext({
                    kind: 'account_settings',
                    material: { type: 'dataKey', machineKey },
                    ciphertext: content.c,
                });
                decryptedSettings = opened?.value ?? (await encryption.decryptRaw(content.c));
            }

            const parsedSettings = decryptedSettings ? settingsParse(decryptedSettings) : settingsParse({});
            const secretsKey = await deriveSettingsSecretsKey(encryption.getContentPrivateKey());
            const sealedSettings = sealSecretsDeep(parsedSettings, secretsKey);

            const localSettings = settingsParse(getLocalSettings ? getLocalSettings() : {});
            const localOnlyAccountSettings = pickLocalOnlyAccountSettings(localSettings);
            const pendingServerSettings = stripLocalOnlyAccountSettings(getPendingSettings ? getPendingSettings() : {});
            const projectedServerSettings = Object.keys(pendingServerSettings).length > 0
                ? applySettingsDelta(sealedSettings, pendingServerSettings)
                : sealedSettings;
            const mergedSettings = {
                ...projectedServerSettings,
                ...localOnlyAccountSettings,
            };

            applyMergedSettings(mergedSettings, version);
            log.log(`📋 Settings synced from server (v2, version ${version})`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.log(`Failed to process settings v2 update: ${message}`);
        }
    } else if (accountUpdate.settings?.value) {
        try {
            const machineKey = encryption.getContentPrivateKey();
            const opened = openAccountScopedBlobCiphertext({
                kind: 'account_settings',
                material: { type: 'dataKey', machineKey },
                ciphertext: accountUpdate.settings.value,
            });
            const decryptedSettings = opened?.value ?? (await encryption.decryptRaw(accountUpdate.settings.value));
            const parsedSettings = settingsParse(decryptedSettings);

            // Version compatibility check
            const settingsSchemaVersion = parsedSettings.schemaVersion ?? 1;
            if (settingsSchemaVersion > SUPPORTED_SCHEMA_VERSION) {
                console.warn(
                    `⚠️ Received settings schema v${settingsSchemaVersion}, ` +
                        `we support v${SUPPORTED_SCHEMA_VERSION}. Update app for full functionality.`,
                );
            }

            const localSettings = settingsParse(getLocalSettings ? getLocalSettings() : {});
            const localOnlyAccountSettings = pickLocalOnlyAccountSettings(localSettings);
            const pendingServerSettings = stripLocalOnlyAccountSettings(getPendingSettings ? getPendingSettings() : {});
            const projectedServerSettings = Object.keys(pendingServerSettings).length > 0
                ? applySettingsDelta(parsedSettings, pendingServerSettings)
                : parsedSettings;
            const mergedSettings = {
                ...projectedServerSettings,
                ...localOnlyAccountSettings,
            };

            applyMergedSettings(mergedSettings, accountUpdate.settings.version);
            log.log(
                `📋 Settings synced from server (schema v${settingsSchemaVersion}, version ${accountUpdate.settings.version})`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.log(`Failed to process settings update: ${message}`);
            // Don't crash on settings sync errors, just log
        }
    }
}

export async function fetchAndApplyProfile(params: {
    credentials: AuthCredentials;
    applyProfile: (profile: Profile) => void;
    shouldContinue?: () => boolean;
}): Promise<void> {
    const { credentials, applyProfile } = params;
    const shouldContinue = params.shouldContinue ?? (() => true);
    if (!shouldContinue()) return;

    const response = await serverFetch('/v1/account/profile', {
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
        },
    }, { includeAuth: false });
    if (!shouldContinue()) return;

    if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
            throw new HappyError(`Failed to fetch profile (${response.status})`, false);
        }
        throw new Error(`Failed to fetch profile: ${response.status}`);
    }

    const data = await response.json();
    const parsedProfile = profileParse(data);
    if (!shouldContinue()) return;

    // Apply profile to storage
    applyProfile(parsedProfile);
}

/**
 * Read the live account settings without giving this sync-engine module a load-time dependency on
 * the store graph. An unreadable store (early boot, isolated test) must not silently disable push,
 * so it degrades to the schema default rather than to "disabled".
 */
function readAccountSettingsFromStore(): unknown {
    try {
        const { storage } = require('@/sync/domains/state/storage') as typeof import('@/sync/domains/state/storage');
        return storage.getState().settings;
    } catch {
        return null;
    }
}

/** 消费既有通知权限，所有异步边界服从本轮注册寿命。 */
async function registerPushTokenIfAvailableInternal(params: {
    credentials: AuthCredentials;
    log: { log: (message: string) => void };
    /**
     * Account settings source. Defaults to the live store; injected by tests and by callers that
     * already hold a settings snapshot.
     */
    getAccountSettings?: () => unknown;
    isCurrent?: () => boolean;
}): Promise<void> {
    const { credentials, log } = params;

    // Only register on mobile platforms
    if (Platform.OS === 'web') {
        return;
    }

    // The account-level push setting governs registration and prompting, not just server-side
    // sending. Registering a token for an account that disabled push would leave a live delivery
    // target contradicting the setting the user can see.
    const readAccountSettings = params.getAccountSettings ?? readAccountSettingsFromStore;
    if (!isExpoPushNotificationChannelEnabled(readAccountSettings())) {
        log.log('Push notifications disabled for this account; skipping push token registration');
        return;
    }

    const permission = await readPushPermission();
    if (params.isCurrent?.() === false) return;
    if (!permission.ok) {
        log.log(`Push notification runtime unavailable (${permission.reason}); skipping push token registration`);
        return;
    }

    // Background registration never prompts. iOS grants exactly one system prompt per install, and
    // spending it from a sync task gives the user no context to decide. The primed permission flow
    // owns the ask; registration only consumes an already-granted permission.
    if (!permission.permission.granted) {
        log.log(`Push notification permission not granted (${permission.permission.status}); skipping push token registration`);
        return;
    }

    const tokenOutcome = await readExpoPushToken();
    if (params.isCurrent?.() === false) return;
    if (!tokenOutcome.ok) {
        log.log(`Unable to read an Expo push token (${tokenOutcome.reason}); skipping push token registration`);
        return;
    }

    // Register with server
    try {
        const profiles = listServerProfiles();
        const token = tokenOutcome.token;
        activeRegistrationToken = token;
        const previousToken = loadLastRegisteredExpoPushToken();
        const normalizeServerUrl = (serverUrl: string) => serverUrl.replace(/\/+$/, '');
        let activeServerUrl: string | null = null;
        try {
            activeServerUrl = normalizeServerUrl(getActiveServerSnapshot().serverUrl);
        } catch {
            activeServerUrl = null;
        }

        let didRegisterActiveServer = false;
        let didRegisterAnyServer = false;
        for (const profile of profiles) {
            if (params.isCurrent?.() === false) return;
            let serverCredentials: AuthCredentials | null = null;
            try {
                serverCredentials = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, { serverId: profile.id });
            } catch {
                serverCredentials = null;
            }
            if (!serverCredentials) continue;
            if (params.isCurrent?.() === false) return;

            try {
                await registerPushTokenBounded(serverCredentials, token, {
                    serverId: profile.id,
                    apiEndpoint: profile.serverUrl,
                    clientServerUrl: profile.serverUrl,
                    retry: 'none',
                    useProvidedCredentials: true,
                });
                didRegisterAnyServer = true;
                if (activeServerUrl && normalizeServerUrl(profile.serverUrl) === activeServerUrl) {
                    didRegisterActiveServer = true;
                }
            } catch (error) {
                const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
                log.log(`Failed to register push token for ${profile.serverUrl}: ${message}`);
            }
        }

        if (params.isCurrent?.() === false) return;
        // Back-compat: if the active server isn't included in profiles for some reason, still try the passed credentials.
        if (!didRegisterActiveServer) {
            await registerPushTokenBounded(credentials, token, {
                apiEndpoint: activeServerUrl ?? undefined,
                clientServerUrl: activeServerUrl ?? undefined,
                retry: 'none',
                useProvidedCredentials: true,
            });
            didRegisterAnyServer = true;
        }

        if (params.isCurrent?.() === false) return;
        if (didRegisterAnyServer) {
            saveLastRegisteredExpoPushToken(token);
        }

        // Best-effort cleanup when Expo rotates the token: remove the old token from servers we can still reach.
        if (didRegisterAnyServer && previousToken && previousToken !== token) {
            const unregisterPreviousToken = async (serverCredentials: AuthCredentials, apiEndpoint?: string) => {
                try {
                    await deletePushTokenApi(serverCredentials, previousToken, { apiEndpoint });
                } catch {
                    // best-effort; ignore
                }
            };

            for (const profile of profiles) {
                let serverCredentials: AuthCredentials | null = null;
                try {
                    serverCredentials = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, { serverId: profile.id });
                } catch {
                    serverCredentials = null;
                }
                if (!serverCredentials) continue;
                await unregisterPreviousToken(serverCredentials, profile.serverUrl);
            }

            await unregisterPreviousToken(credentials, activeServerUrl ?? undefined);
        }
        log.log('Push token registered successfully');
    } catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        log.log('Failed to register push token: ' + message);
    }
}

let pushRegistrationGeneration = 0;
let pushLifecycleTail: Promise<unknown> = Promise.resolve();
let activeRegistrationToken: string | null = null;

/** 注册、解绑在原 owner 串行，避免旧注册成功回执覆盖换号后的本地状态。 */
function enqueuePushLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const work = pushLifecycleTail.catch(() => {}).then(operation);
    pushLifecycleTail = work.catch(() => {});
    return work;
}

/** 使用现有设备 token 注销，不触发原生权限或重新申请 token；失败留作可核对状态。 */
export function unregisterPushTokenOnLogout(input: { credentials: AuthCredentials; serverUrl: string }): Promise<'removed' | 'pending' | 'not_registered'> {
    ++pushRegistrationGeneration;
    const token = activeRegistrationToken ?? loadLastRegisteredExpoPushToken();
    clearLastRegisteredExpoPushToken();
    if (!token) return Promise.resolve('not_registered');
    let accountId: string;
    try { accountId = parseToken(input.credentials.token); } catch { return Promise.resolve('pending'); }
    const record = { serverUrl: input.serverUrl.replace(/\/+$/, ''), accountId, token };
    savePendingExpoPushUnregistration(record);
    return enqueuePushLifecycle(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        try {
            await deletePushTokenApi(input.credentials, token, { apiEndpoint: record.serverUrl, signal: controller.signal });
            clearPendingExpoPushUnregistration(record);
            return 'removed' as const;
        } catch { return 'pending' as const; }
        finally { clearTimeout(timeout); }
    });
}

/** 新账号只能使用自己当前凭据重试解绑；不持久化旧 JWT 或将旧凭据复制到新账号。 */
export async function registerPushTokenIfAvailable(params: Parameters<typeof registerPushTokenIfAvailableInternal>[0]): Promise<void> {
    const generation = pushRegistrationGeneration;
    const snapshot = getActiveServerSnapshot();
    const isCurrent = () => generation === pushRegistrationGeneration && snapshot.generation === getActiveServerSnapshot().generation;
    await enqueuePushLifecycle(async () => {
        if (!isCurrent()) return;
        try {
            let accountId: string | null = null;
            try { accountId = parseToken(params.credentials.token); } catch { /* 旧非标准测试凭据不参与账号待办迁移。 */ }
            for (const record of loadPendingExpoPushUnregistrations()) {
                if (!isCurrent()) return;
                if (record.accountId !== accountId || record.serverUrl !== snapshot.serverUrl.replace(/\/+$/, '')) continue;
                try {
                    await deletePushTokenApi(params.credentials, record.token, { apiEndpoint: record.serverUrl });
                    clearPendingExpoPushUnregistration(record);
                } catch { /* 离线状态仍保留，不能报告已解除。 */ }
            }
            if (isCurrent()) await registerPushTokenIfAvailableInternal({ ...params, isCurrent });
        } finally { activeRegistrationToken = null; }
    });
}

/** 原注册接口增加有界等待；超时不等于服务器已撤回，在途不确定结果由解绑待办保留。 */
async function registerPushTokenBounded(credentials: AuthCredentials, token: string, options: Parameters<typeof registerPushTokenApi>[2]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try { await registerPushTokenApi(credentials, token, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
}
