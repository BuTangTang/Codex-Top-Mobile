import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setMobileWorkspaceExperience = vi.fn();
const environment = vi.hoisted(() => ({ platformOS: 'web' }));

function findNearestItemGroupTitle(node: any): unknown {
    let current = node?.parent;
    while (current) {
        if (current.type === 'ItemGroup') {
            return current.props?.title;
        }
        current = current.parent;
    }
    return undefined;
}

const entryMocks: Parameters<typeof installSessionSettingsEntryModuleMocks>[0] = {
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({ Platform: { get OS() { return environment.platformOS; } } });
    },
    storageModule: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSettingMutable: ((key: string) => {
                    if (key === 'mobileWorkspaceExperienceV1') return ['cockpit', setMobileWorkspaceExperience];
                    if (key === 'sessionTagsEnabled') return [true, vi.fn()];
                    if (key === 'sessionListDensity') return ['cozy', vi.fn()];
                    if (key === 'hideInactiveSessions') return [false, vi.fn()];
                    if (key === 'sessionListActiveGroupingV1') return ['project', vi.fn()];
                    if (key === 'sessionListInactiveGroupingV1') return ['date', vi.fn()];
                    if (key === 'agentInputActionBarLayout') return ['auto', vi.fn()];
                    if (key === 'agentInputChipDensity') return ['auto', vi.fn()];
                    if (key === 'alwaysShowContextSize') return [false, vi.fn()];
                    if (key === 'sessionUseTmux') return [false, vi.fn()];
                    if (key === 'sessionTmuxSessionName') return ['happy', vi.fn()];
                    if (key === 'sessionTmuxIsolated') return [true, vi.fn()];
                    if (key === 'sessionTmuxTmpDir') return [null, vi.fn()];
                    if (key === 'sessionMessageSendMode') return ['agent_queue', vi.fn()];
                    if (key === 'sessionBusySteerSendPolicy') return ['steer_immediately', vi.fn()];
                    if (key === 'agentInputEnterToSend') return [true, vi.fn()];
                    if (key === 'agentInputEnterToSendNative') return [true, vi.fn()];
                    if (key === 'agentInputHistoryScope') return ['perSession', vi.fn()];
                    if (key === 'terminalConnectLegacySecretExportEnabled') return [false, vi.fn()];
                    if (key === 'sessionReplayEnabled') return [false, vi.fn()];
                    if (key === 'sessionReplayStrategy') return ['recent_messages', vi.fn()];
                    if (key === 'sessionReplayRecentMessagesCount') return [250, vi.fn()];
                    if (key === 'sessionReplayMaxSeedChars') return [120000, vi.fn()];
                    if (key === 'sessionReplaySummaryRunnerV1') return [null, vi.fn()];
                    if (key === 'sessionWindowsRemoteSessionLaunchMode') return ['disabled', vi.fn()];
                    if (key === 'sessionWindowsTerminalWindowName') return [null, vi.fn()];
                    return [null, vi.fn()];
                }) as any,
                useLocalSettingMutable: ((key: string) => {
                    if (key === 'sessionsRightPaneDefaultOpen') return [false, vi.fn()];
                    if (key === 'uiMultiPanePanelsEnabled') return [true, vi.fn()];
                    if (key === 'mobileWorkspaceExperienceV1') {
                        throw new Error('mobileWorkspaceExperienceV1 must use synced account settings');
                    }
                    return [null, vi.fn()];
                }) as any,
            },
        });
    },
};
installSessionSettingsEntryModuleMocks(entryMocks);

afterEach(() => {
    standardCleanup();
    setMobileWorkspaceExperience.mockClear();
    resetSessionSettingsEntryState();
    environment.platformOS = 'web';
});

describe('Session settings mobile workspace experience', () => {
    it.each(['ios', 'android'])('hides the old %s phone workspace group without writing preferences', async (platformOS) => {
        environment.platformOS = platformOS;
        installSessionSettingsEntryModuleMocks({ ...entryMocks, useDeviceType: 'phone' });
        const { default: SessionSettingsScreen } = await import('../../../../app/(app)/settings/session');
        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        expect(screen.findRowByTitle('settingsSession.mobileWorkspaceExperience.title')).toBeNull();
        expect(screen.findRowByTitle('settingsSession.cockpitSwipeNavigation.title')).toBeNull();
        expect(setMobileWorkspaceExperience).not.toHaveBeenCalled();
    });

    it.each([{ platformOS: 'web', deviceType: 'phone' as const }, { platformOS: 'android', deviceType: 'tablet' as const }])('preserves the existing switch on $platformOS $deviceType', async ({ platformOS, deviceType }) => {
        environment.platformOS = platformOS;
        installSessionSettingsEntryModuleMocks({ ...entryMocks, useDeviceType: deviceType });
        const { default: SessionSettingsScreen } = await import('../../../../app/(app)/settings/session');
        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        expect(screen.findRowByTitle('settingsSession.mobileWorkspaceExperience.title')).toBeTruthy();
        expect(setMobileWorkspaceExperience).not.toHaveBeenCalled();
    });

    it('surfaces cockpit mode as a synced account setting switch', async () => {
        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = mod.default;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const item = screen.findRowByTitle('settingsSession.mobileWorkspaceExperience.title');
        const switchElement = item?.props?.rightElement;

        expect(item).toBeTruthy();
        expect(findNearestItemGroupTitle(item)).toBe('settingsSession.rootGroups.mobileLayout.title');
        expect(screen.findAllByType('DropdownMenu' as any).some(
            (node: any) => node.props?.itemTrigger?.title === 'settingsSession.mobileWorkspaceExperience.title',
        )).toBe(false);
        expect(switchElement?.type).toBe('Switch');
        expect(switchElement?.props?.value).toBe(true);

        await act(async () => {
            switchElement!.props.onValueChange(false);
        });

        expect(setMobileWorkspaceExperience).toHaveBeenCalledWith('classic');
    });
});
