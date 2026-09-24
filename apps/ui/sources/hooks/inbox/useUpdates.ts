import { useCallback, useEffect } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { useUpdates as useExpoUpdates } from 'expo-updates';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

let otaRuntimeStarted = false;
let otaAppStateSubscription: { remove: () => void } | null = null;
let otaCheckInFlight: Promise<void> | null = null;

function shouldManageOtaUpdates(): boolean {
    return !__DEV__ && Platform.OS !== 'web';
}

async function runSingleFlightOtaCheck(): Promise<void> {
    if (!shouldManageOtaUpdates()) {
        return;
    }

    if (otaCheckInFlight) {
        return otaCheckInFlight;
    }

    otaCheckInFlight = (async () => {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
            await Updates.fetchUpdateAsync();
        }
    })().finally(() => {
        otaCheckInFlight = null;
    });

    return otaCheckInFlight;
}

function startOtaRuntime(): void {
    if (otaAppStateSubscription || !shouldManageOtaUpdates()) {
        return;
    }

    otaAppStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
            void runSingleFlightOtaCheck().catch(() => {});
        }
    });

    void runSingleFlightOtaCheck().catch(() => {});
}

export function useUpdates() {
    const otaUpdatesEnabled = useFeatureEnabled('updates.ota');
    const updatesState = useExpoUpdates();

    const checkForUpdates = useCallback(async () => {
        if (!otaUpdatesEnabled) {
            return;
        }

        await runSingleFlightOtaCheck();
    }, [otaUpdatesEnabled]);

    useEffect(() => {
        if (!otaUpdatesEnabled || otaRuntimeStarted) {
            return;
        }

        otaRuntimeStarted = true;
        startOtaRuntime();
    }, [otaUpdatesEnabled]);

    const reloadApp = useCallback(async () => {
        if (Platform.OS === 'web') {
            window.location.reload();
        } else {
            await Updates.reloadAsync();
        }
    }, []);

    return {
        updateAvailable: otaUpdatesEnabled && updatesState.isUpdatePending,
        isChecking: otaUpdatesEnabled && updatesState.isChecking,
        isDownloading: otaUpdatesEnabled && updatesState.isDownloading,
        isRestarting: otaUpdatesEnabled && updatesState.isRestarting,
        isUpdateAvailable: otaUpdatesEnabled && updatesState.isUpdateAvailable,
        isUpdatePending: otaUpdatesEnabled && updatesState.isUpdatePending,
        downloadProgress: otaUpdatesEnabled ? updatesState.downloadProgress : undefined,
        checkError: otaUpdatesEnabled ? updatesState.checkError : undefined,
        downloadError: otaUpdatesEnabled ? updatesState.downloadError : undefined,
        lastCheckForUpdateTimeSinceRestart: otaUpdatesEnabled ? updatesState.lastCheckForUpdateTimeSinceRestart : undefined,
        availableUpdate: otaUpdatesEnabled ? updatesState.availableUpdate : undefined,
        downloadedUpdate: otaUpdatesEnabled ? updatesState.downloadedUpdate : undefined,
        currentlyRunning: updatesState.currentlyRunning,
        otaUpdatesEnabled,
        checkForUpdates,
        reloadApp,
    };
}
