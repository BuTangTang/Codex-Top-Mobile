import { unregisterPushTokenOnLogout } from '@/sync/engine/account/syncAccount';
import { clearPendingNotificationNav } from '@/sync/domains/pending/pendingNotificationNav';
import { clearPendingNotificationAction } from '@/sync/domains/pending/pendingNotificationAction';
import { assertAuthServerScopeCurrent, type AuthServerScope } from './authServerScope';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { syncSwitchServer } from '@/sync/sync';
import { localSettingsDefaults } from '@/sync/domains/settings/localSettings';
import { clearPersistence, loadLocalSettings, saveLocalSettings } from '@/sync/domains/state/persistence';
import { useApplyLocalSettings } from '@/sync/store/settingsWriters';
import { trackLogout } from '@/track';
import { getActiveServerSnapshot, subscribeActiveServer } from '@/sync/domains/server/serverRuntime';
import { switchConnectionToActiveServer } from '@/sync/runtime/orchestration/connectionManager';
import { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } from '@/sync/runtime/orchestration/concurrentSessionCache';
import { fireAndForget } from '@/utils/system/fireAndForget';

interface AuthContextType {
    isAuthenticated: boolean;
    /**
     * Authentication completed during this app run (a login, not credentials restored at
     * launch). Ephemeral by design: it is the one entry-context fact desktop setup reads to
     * decide whether unresolved local facts show the setup ground or the shell (R14).
     */
    authenticatedThisRun: boolean;
    credentials: AuthCredentials | null;
    login: (token: string, secret: string) => Promise<void>;
    loginWithCredentials: (credentials: AuthCredentials, scope?: AuthServerScope) => Promise<void>;
    logout: () => Promise<void>;
    refreshFromActiveServer: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** 统一持有本端认证状态，过期登录及退出回调不能重新激活账号。 */
export function AuthProvider({ children, initialCredentials }: { children: ReactNode; initialCredentials: AuthCredentials | null }) {
    const [isAuthenticated, setIsAuthenticated] = useState(!!initialCredentials);
    const [authenticatedThisRun, setAuthenticatedThisRun] = useState(false);
    const [credentials, setCredentials] = useState<AuthCredentials | null>(initialCredentials);
    const activeServerKeyRef = React.useRef<string | null>(null);
    const applyLocalSettings = useApplyLocalSettings();
    const authOperationRef = React.useRef(0);

    // 密码登录固定起始服务器和页面代次，旧登录调用省略守卫保持兼容。
    const loginWithCredentials = React.useCallback(async (newCredentials: AuthCredentials, scope?: AuthServerScope) => {
        const operation = ++authOperationRef.current;
        const guardedScope: AuthServerScope = {
            expectedActiveServerSnapshot: scope?.expectedActiveServerSnapshot ?? getActiveServerSnapshot(),
            isStillValid: () => operation === authOperationRef.current && scope?.isStillValid?.() !== false,
        };
        assertAuthServerScopeCurrent(guardedScope);
        const success = await TokenStorage.setCredentials(newCredentials, guardedScope);
        assertAuthServerScopeCurrent(guardedScope);
        if (!success) {
            throw new Error('Failed to save credentials');
        }
        // Mark this device as one where the user has authenticated at least once.
        // We persist this through the store (not raw saveLocalSettings) so the
        // in-memory Zustand `localSettings` slice — which survives logout because
        // clearPersistence only wipes persisted values — also reflects the flag. The welcome
        // screen reads it via useLocalSetting('hasCompletedAuthOnce') to swap to
        // the warmer "Good to have you back" copy on subsequent visits.
        if (!loadLocalSettings().hasCompletedAuthOnce) {
            applyLocalSettings({ hasCompletedAuthOnce: true });
        }
        setCredentials(newCredentials);
        setIsAuthenticated(true);
        setAuthenticatedThisRun(true);
        fireAndForget(syncSwitchServer(newCredentials), { tag: 'AuthContext.login.syncSwitchServer' });
    }, [applyLocalSettings]);

    // 旧密钥登录继续复用统一凭据入口。
    const login = React.useCallback(
        async (token: string, secret: string) => {
            const newCredentials: AuthCredentials = { token, secret };
            await loginWithCredentials(newCredentials);
        },
        [loginWithCredentials],
    );

    // 退出只清当前服务器的本端凭据，并使此前尚未完成的登录失效。
    const logout = React.useCallback(async () => {
        const operation = ++authOperationRef.current;
        const snapshot = getActiveServerSnapshot();
        const scope: AuthServerScope = { expectedActiveServerSnapshot: snapshot, isStillValid: () => operation === authOperationRef.current };
        // 本地退出不等待离线服务器；原推送 owner 保留远端待解绑状态且只用捕获的旧凭据。
        if (credentials) fireAndForget(unregisterPushTokenOnLogout({ credentials, serverUrl: snapshot.serverUrl }), { tag: 'AuthContext.logout.pushUnregister' });
        // 退出时丢弃旧账号的通知定位和所有可执行旧审批意图。
        clearPendingNotificationNav();
        clearPendingNotificationAction();
        trackLogout();
        // Preserve device-local flags across logout — the user is signing out of
        // an account but the device itself has still seen the brand hero and
        // still has prior auth experience. Clearing these would force returning
        // users back into the first-time welcome copy after every logout.
        const { brandHeroSeenAt, hasCompletedAuthOnce } = loadLocalSettings();
        await clearPersistence();
        assertAuthServerScopeCurrent(scope);
        if (brandHeroSeenAt != null || hasCompletedAuthOnce) {
            saveLocalSettings({
                ...localSettingsDefaults,
                brandHeroSeenAt,
                hasCompletedAuthOnce,
            });
        }
        const removed = await TokenStorage.removeCredentialsForServerUrl(snapshot.serverUrl, { serverId: snapshot.serverId });
        assertAuthServerScopeCurrent(scope);
        if (!removed) throw new Error('Failed to remove credentials');
        await syncSwitchServer(null);
        assertAuthServerScopeCurrent(scope);
        setCredentials(null);
        setIsAuthenticated(false);
        setAuthenticatedThisRun(false);
    }, [credentials]);

    // 只采用最近一次服务器刷新，退出或更新的登录完成后丢弃旧回调。
    const refreshFromActiveServer = React.useCallback(async () => {
        const operation = authOperationRef.current;
        const snapshot = getActiveServerSnapshot();
        const nextCredentials = await switchConnectionToActiveServer();
        if (operation !== authOperationRef.current || snapshot.generation !== getActiveServerSnapshot().generation) return;
        setCredentials(nextCredentials);
        setIsAuthenticated(Boolean(nextCredentials));
    }, []);

    // Single source of truth for the context value so consumers (and the non-React
    // `getCurrentAuth()` bridge) share one identity-stable object. Without this memo the
    // provider hands every consumer a fresh object on each render, re-rendering all ~50
    // `useAuth()` callers — including the root layout Stack subtree — on unrelated renders.
    const value = React.useMemo<AuthContextType>(() => ({
        isAuthenticated,
        authenticatedThisRun,
        credentials,
        login,
        loginWithCredentials,
        logout,
        refreshFromActiveServer,
    }), [isAuthenticated, authenticatedThisRun, credentials, login, loginWithCredentials, logout, refreshFromActiveServer]);

    // Update global auth state when local state changes
    useEffect(() => {
        setCurrentAuth(value);
    }, [value]);

    useEffect(() => {
        const unsubscribe = subscribeActiveServer((snapshot) => {
            const serverKey = `${snapshot.serverId}|${snapshot.serverUrl}`;
            if (activeServerKeyRef.current === serverKey) return;
            activeServerKeyRef.current = serverKey;
            fireAndForget(refreshFromActiveServer(), { tag: 'AuthContext.refreshFromActiveServer' });
        });
        return unsubscribe;
    }, [refreshFromActiveServer]);

    useEffect(() => {
        if (!isAuthenticated) {
            stopConcurrentSessionCacheSync();
            return;
        }
        startConcurrentSessionCacheSync();
        return () => {
            stopConcurrentSessionCacheSync();
        };
    }, [isAuthenticated]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

// Helper to get current auth state for non-React contexts
let currentAuthState: AuthContextType | null = null;

export function setCurrentAuth(auth: AuthContextType | null) {
    currentAuthState = auth;
}

export function getCurrentAuth(): AuthContextType | null {
    return currentAuthState;
}
