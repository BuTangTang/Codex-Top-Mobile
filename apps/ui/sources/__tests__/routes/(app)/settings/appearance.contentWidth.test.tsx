import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import { installSessionSettingsEntryModuleMocks, resetSessionSettingsEntryState } from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
    settingsState: {
        themePreference: 'adaptive',
        uiFontScale: 1,
        uiItemDensity: 'comfortable',
        uiContentWidthMode: 'compact',
        uiMultiPanePanelsEnabled: true,
        detailsPaneTabsBehavior: 'preview',
        avatarStyle: 'gradient',
        showFlavorIcons: true,
        preferredLanguage: null,
    } as Record<string, unknown>,
}));

type MutableSettingHook = (key: string) => [unknown, (next: unknown) => void];

const createMutableSettingHook = (settingsState: Record<string, unknown>): MutableSettingHook => {
    return (key: string) => [
        Object.prototype.hasOwnProperty.call(settingsState, key) ? settingsState[key] : null,
        (next: unknown) => {
            settingsState[key] = next;
        },
    ];
};

installSessionSettingsEntryModuleMocks({
    textModule: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return {
            ...createTextModuleMock(),
            getLanguageNativeName: () => 'English',
            SUPPORTED_LANGUAGES: { en: true },
        };
    },
    storageModule: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        const mutableSetting = createMutableSettingHook(shared.settingsState);
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSettingMutable: mutableSetting as typeof import('@/sync/domains/state/storage')['useSettingMutable'],
                useLocalSettingMutable: mutableSetting as typeof import('@/sync/domains/state/storage')['useLocalSettingMutable'],
            },
        });
    },
    useDeviceType: 'desktop',
});

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
vi.mock('expo-system-ui', () => ({ setBackgroundColorAsync: vi.fn() }));

afterEach(() => {
    standardCleanup();
    resetSessionSettingsEntryState();
    shared.settingsState.uiContentWidthMode = 'compact';
});

describe('Appearance settings content width', () => {
    it('renders the content width dropdown and updates the local setting', async () => {
        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default), {
            flushOptions: { cycles: 0 },
        });

        const dropdowns = screen.findAllByType('DropdownMenu' as any);
        const contentWidthDropdown = dropdowns.find((node: any) => node.props?.itemTrigger?.title === 'settingsAppearance.contentWidth');
        expect(contentWidthDropdown).toBeTruthy();
        expect(contentWidthDropdown?.props?.selectedId).toBe('compact');

        const itemIds = contentWidthDropdown?.props?.items?.map((item: any) => item.id) ?? [];
        expect(itemIds).toEqual(['compact', 'medium', 'full']);

        await act(async () => {
            contentWidthDropdown!.props.onSelect('full');
        });

        expect(shared.settingsState.uiContentWidthMode).toBe('full');
    });
});
