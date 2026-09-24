import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { renderHookAndCollectValues, flushHookEffects } from '@/hooks/server/serverFeatureHookHarness.testHelpers';
import { stubServerFeaturesFetch } from '@/hooks/server/serverFeaturesTestUtils';

vi.mock('expo-updates', () => ({
    checkForUpdateAsync: vi.fn(async () => ({ isAvailable: false })),
    fetchUpdateAsync: vi.fn(async () => {}),
    reloadAsync: vi.fn(async () => {}),
    useUpdates: vi.fn(() => ({
        currentlyRunning: {},
        isChecking: false,
        isDownloading: false,
        isRestarting: false,
        isStartupProcedureRunning: false,
        isUpdateAvailable: false,
        isUpdatePending: false,
        restartCount: 0,
    })),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            OS: 'ios',
            select: <T,>(options: { ios?: T; native?: T; default?: T; web?: T; android?: T }) =>
                options?.ios ?? options?.native ?? options?.default ?? options?.web ?? options?.android,
        },
    });
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

async function flushMore() {
    await flushHookEffects(10);
}

function prepareNativeProductionFeatureProbe(updatesOtaEnabled: boolean): void {
    vi.resetModules();
    vi.stubGlobal('__DEV__', false);
    stubServerFeaturesFetch({ updatesOtaEnabled });
}

async function getCheckForUpdateAsyncMock() {
    const Updates = await import('expo-updates');
    return vi.mocked(Updates.checkForUpdateAsync);
}

describe('useUpdates (OTA gating)', () => {
    it('does not check for OTA updates when updates.ota is disabled', async () => {
        prepareNativeProductionFeatureProbe(false);

        const { useUpdates } = await import('./useUpdates');
        await renderHookAndCollectValues(() => useUpdates());
        await flushMore();

        const checkForUpdateAsync = await getCheckForUpdateAsyncMock();
        expect(checkForUpdateAsync).not.toHaveBeenCalled();
    });

    it('checks for OTA updates when updates.ota is enabled', async () => {
        prepareNativeProductionFeatureProbe(true);

        const { useUpdates } = await import('./useUpdates');
        await renderHookAndCollectValues(() => useUpdates());
        await flushMore();

        const checkForUpdateAsync = await getCheckForUpdateAsyncMock();
        expect(checkForUpdateAsync).toHaveBeenCalledTimes(1);
    });

    it('shares startup update checks across multiple consumers', async () => {
        prepareNativeProductionFeatureProbe(true);
        const checkForUpdateAsync = await getCheckForUpdateAsyncMock();
        checkForUpdateAsync.mockClear();

        const { useUpdates } = await import('./useUpdates');
        const harness = await renderHook(() => {
            useUpdates();
            useUpdates();
            return null;
        });

        await flushHookEffects(10);

        expect(checkForUpdateAsync).toHaveBeenCalledTimes(1);

        await harness.unmount();
    });
});
