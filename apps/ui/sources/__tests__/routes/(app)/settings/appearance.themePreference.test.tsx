import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import { BUILT_IN_THEME_PROFILES } from '@/theme/profiles/builtInThemeProfiles';
import { installSessionSettingsEntryModuleMocks, resetSessionSettingsEntryState, sessionSettingsEntryState } from './sessionSettingsEntryTestHelpers';

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
testGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
    settingsState: {
        themePreference: 'light',
        uiFontScale: 1,
        uiItemDensity: 'comfortable',
        uiMultiPanePanelsEnabled: true,
        detailsPaneTabsBehavior: 'preview',
        avatarStyle: 'gradient',
        showFlavorIcons: true,
        preferredLanguage: null,
        themeProfiles: { activeProfileIds: { light: null, dark: null }, profiles: [] },
    } as Record<string, unknown>,
    setAdaptiveThemes: vi.fn(),
    setTheme: vi.fn(),
    setRootViewBackgroundColor: vi.fn(),
    setStatusBarStyle: vi.fn(),
    setSystemBackgroundColorAsync: vi.fn(),
    startViewTransition: vi.fn(),
    documentElementAnimate: vi.fn(),
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
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Appearance: { getColorScheme: () => 'light' },
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    accent: { blue: '#00f', orange: '#f90', indigo: '#6366f1' },
                    status: { connecting: '#09f' },
                },
            },
            runtime: {
                setAdaptiveThemes: shared.setAdaptiveThemes,
                setTheme: shared.setTheme,
                setRootViewBackgroundColor: shared.setRootViewBackgroundColor,
            },
        });
    },
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
vi.mock('expo-status-bar', () => ({ setStatusBarStyle: shared.setStatusBarStyle }));
vi.mock('expo-system-ui', () => ({ setBackgroundColorAsync: shared.setSystemBackgroundColorAsync }));
vi.mock('@/theme', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/theme')>();
    return {
        ...actual,
        darkTheme: {
            ...actual.darkTheme,
            colors: {
                ...actual.darkTheme.colors,
                groupped: { background: '#000' },
            },
        },
        lightTheme: {
            ...actual.lightTheme,
            colors: {
                ...actual.lightTheme.colors,
                groupped: { background: '#fff' },
            },
        },
    };
});

afterEach(() => {
    standardCleanup();
    resetSessionSettingsEntryState();
    Reflect.deleteProperty(globalThis, 'document');
    shared.settingsState.themePreference = 'light';
    shared.settingsState.themeProfiles = { activeProfileIds: { light: null, dark: null }, profiles: [] };
    shared.setAdaptiveThemes.mockClear();
    shared.setTheme.mockClear();
    shared.setRootViewBackgroundColor.mockClear();
    shared.setStatusBarStyle.mockClear();
    shared.setSystemBackgroundColorAsync.mockClear();
    shared.startViewTransition.mockClear();
    shared.startViewTransition.mockImplementation((update: () => void) => {
        update();
        return { ready: Promise.resolve() };
    });
    shared.documentElementAnimate.mockClear();
});

describe('Appearance settings theme preference', () => {
    const findDropdownByTriggerTestId = (
        screen: Awaited<ReturnType<typeof renderSettingsView>>,
        testID: string,
    ) => screen.findAllByType('DropdownMenu' as any)
        .find((node: any) => node.props?.itemTrigger?.itemProps?.testID === testID);

    /** 手机保留主题和字号操作，但不提供语言切换入口。 */
    it('keeps phone theme and text controls without a language switch', async () => {
        sessionSettingsEntryState.options.useDeviceType = 'phone';
        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default));
        expect(screen.findRow('settings-appearance-themeProfiles')).toBeNull();
        for (const title of ['settingsAppearance.multiPanePanels', 'settingsAppearance.backdropBlur', 'tabs.friends', 'tabs.inbox']) {
            expect(screen.findRowByTitle(title)).toBeNull();
        }
        const currentTheme = findDropdownByTriggerTestId(screen, 'settings-theme-selector-trigger');
        expect(currentTheme?.props.items.map((item: { id: string }) => item.id)).toEqual(['adaptive', 'light', 'dark']);
        await act(async () => { currentTheme!.props.onSelect('dark'); });
        expect(shared.settingsState.themePreference).toBe('dark');
        const fontSize = screen.findAllByType('DropdownMenu' as any).find((node) => node.props.itemTrigger?.title === 'settingsAppearance.textSize');
        await act(async () => { fontSize!.props.onSelect('large'); });
        expect(shared.settingsState.uiFontScale).toBe(1.1);
        expect(screen.findRowByTitle('settingsLanguage.currentLanguage')).toBeNull();
        expect(sessionSettingsEntryState.routerPushSpy).not.toHaveBeenCalledWith('/settings/language');
    });

    /** 手机打开旧自定义主题时不改偏好，主动选择基础模式才清除该模式的自定义选择。 */
    it.each(['light', 'dark'] as const)('preserves a custom %s profile until a phone user chooses the base theme', async (mode) => {
        sessionSettingsEntryState.options.useDeviceType = 'phone';
        const customProfile = { ...BUILT_IN_THEME_PROFILES[0].profile, id: 'personal-theme', name: 'My Theme 自定义' };
        const originalProfiles = { activeProfileIds: { light: customProfile.id, dark: customProfile.id }, profiles: [customProfile] };
        shared.settingsState.themePreference = mode;
        shared.settingsState.themeProfiles = originalProfiles;
        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default));
        const currentTheme = findDropdownByTriggerTestId(screen, 'settings-theme-selector-trigger');
        expect(shared.settingsState.themeProfiles).toBe(originalProfiles);
        expect(shared.setTheme).not.toHaveBeenCalled();
        expect(currentTheme?.props.itemTrigger.subtitle).toBe(customProfile.name);
        expect(currentTheme?.props.items.map((item: { id: string }) => item.id)).toEqual(['adaptive', 'light', 'dark']);
        await act(async () => { currentTheme!.props.onSelect(mode); });
        const nextProfiles = shared.settingsState.themeProfiles as typeof originalProfiles;
        expect(shared.settingsState.themePreference).toBe(mode);
        expect(nextProfiles.activeProfileIds[mode]).toBeNull();
        expect(nextProfiles.activeProfileIds[mode === 'dark' ? 'light' : 'dark']).toBe(customProfile.id);
        expect(nextProfiles.profiles).toEqual([customProfile]);
        expect(shared.setTheme).toHaveBeenLastCalledWith(mode);
    });

    /** 旧内置配色继续生效，但手机不把英文预设名或只读说明当作普通设置文案。 */
    it('keeps an existing built-in profile without exposing its preset label on phone', async () => {
        sessionSettingsEntryState.options.useDeviceType = 'phone';
        const originalProfiles = { activeProfileIds: { light: null, dark: 'premiumDark' }, profiles: [] };
        shared.settingsState.themePreference = 'dark';
        shared.settingsState.themeProfiles = originalProfiles;
        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default));
        const currentTheme = findDropdownByTriggerTestId(screen, 'settings-theme-selector-trigger');
        expect(currentTheme?.props.itemTrigger.subtitle).toBe('settingsAppearance.themeProfiles.active');
        expect(shared.settingsState.themeProfiles).toBe(originalProfiles);
        expect(shared.setTheme).not.toHaveBeenCalled();
    });

    it('renders one current-theme dropdown outside adaptive mode', async () => {
        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default), {
            flushOptions: { cycles: 0 },
        });

        const currentThemeDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-selector-trigger');
        const lightDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-light-selector-trigger');
        const darkDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-dark-selector-trigger');

        expect(currentThemeDropdown).toBeTruthy();
        expect(lightDropdown).toBeUndefined();
        expect(darkDropdown).toBeUndefined();
        expect(currentThemeDropdown?.props.selectedId).toBe('light');
        expect(currentThemeDropdown?.props.items.map((item: any) => item.id)).toEqual([
            'adaptive',
            'light',
            'dark',
            ...BUILT_IN_THEME_PROFILES.map((definition) => definition.profile.id),
        ]);
    });

    it('shows light and dark slot dropdowns only when adaptive mode is selected', async () => {
        shared.settingsState.themePreference = 'adaptive';

        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default), {
            flushOptions: { cycles: 0 },
        });

        const currentThemeDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-selector-trigger');
        const lightDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-light-selector-trigger');
        const darkDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-dark-selector-trigger');

        expect(currentThemeDropdown).toBeTruthy();
        expect(lightDropdown).toBeTruthy();
        expect(darkDropdown).toBeTruthy();
        expect(currentThemeDropdown?.props.selectedId).toBe('adaptive');
        expect(lightDropdown?.props.selectedId).toBe('light');
        expect(darkDropdown?.props.selectedId).toBe('dark');
        expect(currentThemeDropdown?.props.items.map((item: any) => item.id)).toEqual([
            'adaptive',
            'light',
            'dark',
            ...BUILT_IN_THEME_PROFILES.map((definition) => definition.profile.id),
        ]);
        expect(lightDropdown?.props.items.map((item: any) => item.id)).toEqual([
            'light',
            ...BUILT_IN_THEME_PROFILES
                .filter((definition) => definition.preferredMode === 'light')
                .map((definition) => definition.profile.id),
        ]);
        expect(darkDropdown?.props.items.map((item: any) => item.id)).toEqual([
            'dark',
            ...BUILT_IN_THEME_PROFILES
                .filter((definition) => definition.preferredMode === 'dark')
                .map((definition) => definition.profile.id),
        ]);
    });

    it('applies status bar style immediately when selecting dark mode', async () => {
        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default), {
            flushOptions: { cycles: 0 },
        });

        const themeDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-selector-trigger');

        await act(async () => {
            themeDropdown!.props.onSelect('dark');
        });

        expect(shared.settingsState.themePreference).toBe('dark');
        expect(shared.setTheme).toHaveBeenCalledWith('dark');
        expect(shared.setStatusBarStyle).toHaveBeenCalledWith('light', true);
    });

    it('wraps web theme changes in a view transition', async () => {
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                documentElement: {
                    animate: shared.documentElementAnimate,
                },
                startViewTransition: shared.startViewTransition,
            } as unknown as Document,
        });

        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default), {
            flushOptions: { cycles: 0 },
        });

        const themeDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-selector-trigger');

        await act(async () => {
            themeDropdown!.props.onSelect('dark');
        });

        expect(shared.startViewTransition).toHaveBeenCalledOnce();
        expect(shared.documentElementAnimate).toHaveBeenCalledWith(
            { clipPath: ['inset(0 0 100% 0)', 'inset(0)'] },
            expect.objectContaining({ pseudoElement: '::view-transition-new(root)' }),
        );
    });

    it('selects a curated dark theme from the current-theme dropdown for always-dark mode', async () => {
        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default), {
            flushOptions: { cycles: 0 },
        });

        const themeDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-selector-trigger');

        await act(async () => {
            themeDropdown!.props.onSelect('premiumDark');
        });

        const themeProfiles = shared.settingsState.themeProfiles as { activeProfileIds: { light: string | null; dark: string | null }; profiles: Array<{ id: string; overrides: { dark: Record<string, string> } }> };
        expect(shared.settingsState.themePreference).toBe('dark');
        expect(themeProfiles.activeProfileIds).toEqual({ light: null, dark: 'premiumDark' });
        expect(themeProfiles.profiles).toEqual([]);
        expect(shared.setTheme).toHaveBeenCalledWith('dark');
    });

    it('assigns a curated dark theme from the adaptive dark slot without changing appearance mode', async () => {
        shared.settingsState.themePreference = 'adaptive';

        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default), {
            flushOptions: { cycles: 0 },
        });

        const themeDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-dark-selector-trigger');

        await act(async () => {
            themeDropdown!.props.onSelect('nightDark');
        });

        const themeProfiles = shared.settingsState.themeProfiles as { activeProfileIds: { light: string | null; dark: string | null }; profiles: Array<{ id: string }> };
        expect(shared.settingsState.themePreference).toBe('adaptive');
        expect(themeProfiles.activeProfileIds).toEqual({ light: null, dark: 'nightDark' });
        expect(themeProfiles.profiles).toEqual([]);
        expect(shared.setAdaptiveThemes).toHaveBeenCalledWith(true);
    });

    it('animates same-mode built-in theme switches from the dark slot dropdown', async () => {
        shared.settingsState.themePreference = 'dark';
        shared.settingsState.themeProfiles = { activeProfileIds: { light: null, dark: 'premiumDark' }, profiles: [] };
        shared.startViewTransition.mockImplementation((mutation: () => void) => {
            mutation();
            return { ready: Promise.resolve() };
        });
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                documentElement: {
                    animate: shared.documentElementAnimate,
                },
                startViewTransition: shared.startViewTransition,
            } as unknown as Document,
        });

        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default), {
            flushOptions: { cycles: 0 },
        });

        const themeDropdown = findDropdownByTriggerTestId(screen, 'settings-theme-selector-trigger');

        await act(async () => {
            themeDropdown!.props.onSelect('nightDark');
        });

        expect(shared.startViewTransition).toHaveBeenCalledOnce();
        expect(shared.documentElementAnimate).toHaveBeenCalled();
        expect((shared.settingsState.themeProfiles as { activeProfileIds: { light: string | null; dark: string | null } }).activeProfileIds).toEqual({
            light: null,
            dark: 'nightDark',
        });
    });

    it('opens theme profile management from the theme group', async () => {
        const mod = await import('@/app/(app)/settings/appearance');
        const screen = await renderSettingsView(React.createElement(mod.default), {
            flushOptions: { cycles: 0 },
        });

        await act(async () => {
            screen.pressByTestId('settings-appearance-themeProfiles');
        });

        expect(sessionSettingsEntryState.routerPushSpy).toHaveBeenCalledWith('/settings/appearance/themes');
    });
});
