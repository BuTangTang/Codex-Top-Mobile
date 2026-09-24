import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createExpoRouterMock, renderSettingsView } from '@/dev/testkit';
import { lightTheme } from '@/theme';
import { installSettingsViewCommonModuleMocks } from './settingsViewTestHelpers';

installSettingsViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeNativeMock({ platformOS: 'android' });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
});

import { SettingsBelowFoldSections } from './SettingsBelowFoldSections';

/** 提供安全的设置展示样例，路由仍通过系统导航边界观察。 */
function settingsProps() {
    return {
        appVersion: '1.0.2',
        attachmentsUploadsEnabled: true,
        automationsNeedLocalEnablement: false,
        connectedServicesEnabled: true,
        devModeEnabled: false,
        executionRunsEnabled: true,
        handleGitHub: vi.fn(),
        handleReportIssue: vi.fn(),
        handleVersionClick: vi.fn(),
        mcpServersEnabled: true,
        memorySearchEnabled: true,
        promptsLibraryEnabled: true,
        router: {
            ...createExpoRouterMock().module.useRouter(),
            canGoBack: () => false,
            dismiss: vi.fn(),
            reload: vi.fn(),
            prefetch: vi.fn(),
            setParams: vi.fn(),
        },
        showAutomations: true,
        showChangelog: true,
        showRateUs: false,
        sourceControlEnabled: true,
        stage: 4,
        terminalUseTmux: false,
        theme: lightTheme,
        useProfiles: true,
        voiceEnabled: true,
    };
}

describe('mobile settings disclosure', () => {
    it('keeps the mobile About surface free of old expert and pairing entrances', async () => {
        const props = { ...settingsProps(), devModeEnabled: true, moreSettingsExpanded: true, onToggleMoreSettings: vi.fn() };
        const screen = await renderSettingsView(<SettingsBelowFoldSections {...props} compact />);
        expect(screen.findRow('settings-more-settings')).toBeNull();
        expect(screen.findRowByTitle('settings.sessions')).toBeNull();
        expect(screen.findRowByTitle('settingsProviders.title')).toBeNull();
        await act(async () => { screen.pressRow('settings-about-disclosure'); });
        expect(screen.findRowByTitle('common.version')).not.toBeNull();
        expect(screen.findRowByTitle('common.version')!.props.onPress).toBeUndefined();
        expect(screen.findRow('settings-more-settings')).toBeNull();
    });

    it('keeps legal and version details behind About without exposing promotion', async () => {
        const props = { ...settingsProps(), showRateUs: true };
        const screen = await renderSettingsView(<SettingsBelowFoldSections {...props} compact />);
        expect(screen.findRowByTitle('settings.github')).toBeNull();
        expect(screen.findRowByTitle('settings.rateUs')).toBeNull();
        expect(screen.findRowByTitle('settings.privacyPolicy')).toBeNull();
        await act(async () => { screen.pressRow('settings-about-disclosure'); });
        expect(screen.findRowByTitle('settings.privacyPolicy')).toBeNull();
        expect(screen.findRowByTitle('settings.reportIssue')).toBeNull();
        screen.pressRow('settings-open-source-materials');
        expect(props.handleGitHub).toHaveBeenCalledOnce();
        expect(screen.findRowByTitle('common.version')).not.toBeNull();
        await act(async () => { screen.pressRow('settings-about-disclosure'); });
        expect(screen.findRowByTitle('settings.privacyPolicy')).toBeNull();
    });

    it('retains all desktop sections without a mobile disclosure', async () => {
        const props = settingsProps();
        const screen = await renderSettingsView(<SettingsBelowFoldSections {...props} />);

        expect(screen.findRow('settings-more-settings')).toBeNull();
        expect(screen.findRowByTitle('settings.sessions')).not.toBeNull();
        screen.pressRowByTitle('settings.servers');
        expect(props.router.push).toHaveBeenCalledWith('/settings/server');
        screen.pressRowByTitle('settings.notifications');
        expect(props.router.push).toHaveBeenCalledWith('/settings/notifications');
    });
});
