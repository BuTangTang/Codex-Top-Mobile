import React from 'react';
import { Appearance, Platform, View } from 'react-native';
import { setStatusBarStyle } from 'expo-status-bar';
import { Item } from '@/components/ui/lists/Item';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { ItemList } from '@/components/ui/lists/ItemList';
import { useSettingMutable, useLocalSettingMutable } from '@/sync/domains/state/storage';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { Switch } from '@/components/ui/forms/Switch';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { ThemeSelectionDropdown, buildCurrentThemeSelectionOptions, type ThemeSelectionOption } from '@/components/settings/appearance/themeProfiles/ThemeSelectionDropdown';
import { t } from '@/text';
import { isRunningOnMac } from '@/utils/platform/platform';
import { isTauriDesktop } from '@/utils/platform/tauri';
import { useDeviceType } from '@/utils/platform/responsive';
import {
    AVATAR_STYLE_OPTIONS,
    isAvatarStyleId,
    normalizeAvatarStyleId,
} from '@/components/ui/avatar/avatarStyleOptions';
import { getGeneratedAvatarComponentForStyle } from '@/components/ui/avatar/avatarComponentRegistry';
import type { AvatarStyleId } from '@/sync/domains/settings/registry/account/avatarStyleSetting';
import { resolveStatusBarStyleForThemePreference } from '@/components/ui/layout/statusBarStyle';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { runThemePreferenceChange } from '@/components/settings/appearance/themePreferenceTransition';
import { applyThemeRuntimeSelection } from '@/theme/profiles/themeProfileRuntime';
import {
    DEFAULT_THEME_PROFILES_LOCAL_STATE,
    findActiveThemeProfileForMode,
    setActiveThemeProfileForMode,
} from '@/theme/profiles/themeProfilePersistence';
import { isBuiltInThemeProfilePresetId } from '@/theme/profiles/builtInThemeProfiles';
import type { ThemeProfileMode, ThemeProfilesLocalStateV1 } from '@/theme/profiles/themeProfileTypes';
import type { LocalSettings } from '@/sync/domains/settings/localSettings';
import { Icon } from '@/components/ui/icons/Icon';

const UI_FONT_SCALE_PRESETS = {
    xxsmall: 0.8,
    xsmall: 0.85,
    small: 0.93,
    default: 1,
    large: 1.1,
    xlarge: 1.2,
    xxlarge: 1.3,
} as const;

type UiFontScalePresetId = keyof typeof UI_FONT_SCALE_PRESETS;
type UiItemDensity = LocalSettings['uiItemDensity'];
type DetailsPaneTabsBehavior = LocalSettings['detailsPaneTabsBehavior'];

const isUiFontScalePresetId = (value: string): value is UiFontScalePresetId => (
    Object.prototype.hasOwnProperty.call(UI_FONT_SCALE_PRESETS, value)
);

const isUiItemDensity = (value: string): value is UiItemDensity => (
    value === 'comfortable' || value === 'cozy' || value === 'compact'
);

const isDetailsPaneTabsBehavior = (value: string): value is DetailsPaneTabsBehavior => (
    value === 'preview' || value === 'persistent'
);

function AvatarStylePreviewIcon(props: Readonly<{ styleId: AvatarStyleId }>) {
    const AvatarStyleComponent = getGeneratedAvatarComponentForStyle(props.styleId);

    return (
        <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <AvatarStyleComponent
                id={`settings-avatar-style-preview-${props.styleId}`}
                styleId={props.styleId}
                size={28}
            />
        </View>
    );
}

/** 显示外观设置；产品固定简体中文，不再提供语言选择。 */
export default React.memo(function AppearanceSettingsScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const deviceType = useDeviceType();
    // 手机只保留主题和字体，所有值仍写入原设置 owner。
    const isPhoneLayout = deviceType === 'phone' && !isRunningOnMac() && !isTauriDesktop();
    const reduceMotion = useReducedMotionPreference();
    const panelsSupported = Platform.OS === 'web' || deviceType === 'tablet';
    const [avatarStyle, setAvatarStyle] = useSettingMutable('avatarStyle');
    const [showFlavorIcons, setShowFlavorIcons] = useSettingMutable('showFlavorIcons');
    const [themePreference, setThemePreference] = useLocalSettingMutable('themePreference');
    const [themeProfiles, setThemeProfiles] = useLocalSettingMutable('themeProfiles');
    const [uiFontScale, setUiFontScale] = useLocalSettingMutable('uiFontScale');
    const [uiItemDensity, setUiItemDensity] = useLocalSettingMutable('uiItemDensity');
    const [uiContentWidthMode, setUiContentWidthMode] = useLocalSettingMutable('uiContentWidthMode');
    const [uiMultiPanePanelsEnabled, setUiMultiPanePanelsEnabled] = useLocalSettingMutable('uiMultiPanePanelsEnabled');
    const [uiBackdropBlurEnabled, setUiBackdropBlurEnabled] = useLocalSettingMutable('uiBackdropBlurEnabled');
    const [detailsPaneTabsBehavior, setDetailsPaneTabsBehavior] = useLocalSettingMutable('detailsPaneTabsBehavior');
    const [tabBarGitBadgeMode, setTabBarGitBadgeMode] = useSettingMutable('tabBarGitBadgeMode');
    const [tabBarFriendsBadgeEnabled, setTabBarFriendsBadgeEnabled] = useSettingMutable('tabBarFriendsBadgeEnabled');
    const [tabBarInboxBadgeEnabled, setTabBarInboxBadgeEnabled] = useSettingMutable('tabBarInboxBadgeEnabled');
    const [tabBarOpenTabsBadgeEnabled, setTabBarOpenTabsBadgeEnabled] = useSettingMutable('tabBarOpenTabsBadgeEnabled');
    const [tabBarShowLabels, setTabBarShowLabels] = useSettingMutable('tabBarShowLabels');
    const [tabBarSize, setTabBarSize] = useSettingMutable('tabBarSize');
    const [glassBlurEnabled, setGlassBlurEnabled] = useSettingMutable('glassBlurEnabled');
    const [glassBlurIntensity, setGlassBlurIntensity] = useSettingMutable('glassBlurIntensity');
    const [openTextSizeMenu, setOpenTextSizeMenu] = React.useState(false);
    const [openThemeMenu, setOpenThemeMenu] = React.useState(false);
    const [openLightThemeMenu, setOpenLightThemeMenu] = React.useState(false);
    const [openDarkThemeMenu, setOpenDarkThemeMenu] = React.useState(false);
    const [openItemDensityMenu, setOpenItemDensityMenu] = React.useState(false);
    const [openContentWidthMenu, setOpenContentWidthMenu] = React.useState(false);
    const [openDetailsTabsMenu, setOpenDetailsTabsMenu] = React.useState(false);
    const [openAvatarStyleMenu, setOpenAvatarStyleMenu] = React.useState(false);
    const [openGitBadgeMenu, setOpenGitBadgeMenu] = React.useState(false);
    const [openTabBarSizeMenu, setOpenTabBarSizeMenu] = React.useState(false);
    const [openGlassBlurMenu, setOpenGlassBlurMenu] = React.useState(false);
    const safeThemeProfiles = themeProfiles ?? DEFAULT_THEME_PROFILES_LOCAL_STATE;
    const activeLightThemeProfile = React.useMemo(
        () => findActiveThemeProfileForMode(safeThemeProfiles, 'light'),
        [safeThemeProfiles],
    );
    const activeDarkThemeProfile = React.useMemo(
        () => findActiveThemeProfileForMode(safeThemeProfiles, 'dark'),
        [safeThemeProfiles],
    );
    const activeThemeProfilesSubtitle = React.useMemo(() => {
        const defaultTheme = t('settingsAppearance.themeProfiles.defaultTheme');
        return `${activeLightThemeProfile?.name ?? defaultTheme} / ${activeDarkThemeProfile?.name ?? defaultTheme}`;
    }, [activeDarkThemeProfile?.name, activeLightThemeProfile?.name]);
    const textSizeMenuItems = React.useMemo((): readonly DropdownMenuItem[] => {
        return [
            { id: 'xxsmall', title: t('settingsAppearance.textSizeOptions.xxsmall') },
            { id: 'xsmall', title: t('settingsAppearance.textSizeOptions.xsmall') },
            { id: 'small', title: t('settingsAppearance.textSizeOptions.small') },
            { id: 'default', title: t('settingsAppearance.textSizeOptions.default') },
            { id: 'large', title: t('settingsAppearance.textSizeOptions.large') },
            { id: 'xlarge', title: t('settingsAppearance.textSizeOptions.xlarge') },
            { id: 'xxlarge', title: t('settingsAppearance.textSizeOptions.xxlarge') },
        ];
    }, []);

    const detailsTabsMenuItems = React.useMemo(() => {
        return [
            { id: 'preview', title: t('settingsAppearance.detailsPaneTabsBehaviorOptions.preview') },
            { id: 'persistent', title: t('settingsAppearance.detailsPaneTabsBehaviorOptions.persistent') },
        ];
    }, []);

    const avatarStyleMenuItems = React.useMemo(() => {
        return AVATAR_STYLE_OPTIONS.map((option) => ({
            id: option.id,
            title: t(option.labelKey),
            icon: <AvatarStylePreviewIcon styleId={option.id} />,
        }));
    }, []);

    const gitBadgeMenuItems = React.useMemo((): readonly DropdownMenuItem[] => {
        return [
            { id: 'changedFiles', title: t('settingsAppearance.tabBarBadges.gitChangedFiles') },
            { id: 'diffLines', title: t('settingsAppearance.tabBarBadges.gitDiffLines') },
            { id: 'off', title: t('settingsAppearance.tabBarBadges.gitOff') },
        ];
    }, []);

    const tabBarSizeMenuItems = React.useMemo((): readonly DropdownMenuItem[] => {
        return [
            { id: 'compact', title: t('settingsAppearance.tabBarAppearance.sizeCompact') },
            { id: 'regular', title: t('settingsAppearance.tabBarAppearance.sizeRegular') },
            { id: 'large', title: t('settingsAppearance.tabBarAppearance.sizeLarge') },
        ];
    }, []);

    const glassBlurIntensityMenuItems = React.useMemo((): readonly DropdownMenuItem[] => {
        return [
            { id: 'light', title: t('settingsAppearance.glass.intensityLight') },
            { id: 'regular', title: t('settingsAppearance.glass.intensityRegular') },
            { id: 'strong', title: t('settingsAppearance.glass.intensityStrong') },
        ];
    }, []);

    const itemDensityMenuItems = React.useMemo(() => {
        return [
            {
                id: 'comfortable',
                title: t('settingsAppearance.itemDensityOptions.comfortable'),
                subtitle: t('settingsAppearance.itemDensityOptions.comfortableDescription'),
            },
            {
                id: 'cozy',
                title: t('settingsAppearance.itemDensityOptions.cozy'),
                subtitle: t('settingsAppearance.itemDensityOptions.cozyDescription'),
            },
            {
                id: 'compact',
                title: t('settingsAppearance.itemDensityOptions.compact'),
                subtitle: t('settingsAppearance.itemDensityOptions.compactDescription'),
            },
        ];
    }, []);

    const contentWidthMenuItems = React.useMemo(() => {
        return [
            {
                id: 'compact',
                title: t('settingsAppearance.contentWidthOptions.compact'),
                subtitle: t('settingsAppearance.contentWidthOptions.compactDescription'),
            },
            {
                id: 'medium',
                title: t('settingsAppearance.contentWidthOptions.medium'),
                subtitle: t('settingsAppearance.contentWidthOptions.mediumDescription'),
            },
            {
                id: 'full',
                title: t('settingsAppearance.contentWidthOptions.full'),
                subtitle: t('settingsAppearance.contentWidthOptions.fullDescription'),
            },
        ];
    }, []);

    const selectedTextSizeId = React.useMemo(() => {
        const entries = Object.entries(UI_FONT_SCALE_PRESETS) as Array<[UiFontScalePresetId, number]>;
        let best: UiFontScalePresetId = 'default';
        let bestDist = Number.POSITIVE_INFINITY;
        for (const [id, scale] of entries) {
            const dist = Math.abs((uiFontScale ?? 1) - scale);
            if (dist < bestDist) {
                bestDist = dist;
                best = id;
            }
        }
        return best;
    }, [uiFontScale]);

    const selectUiFontSize = React.useCallback((itemId: string) => {
        if (!isUiFontScalePresetId(itemId)) return;
        setUiFontScale(UI_FONT_SCALE_PRESETS[itemId]);
    }, [setUiFontScale]);

    /** 通过既有主题运行时统一更新模式、配置与状态栏，并遵循减少动态效果偏好。 */
    const applyThemeSelection = React.useCallback((nextThemePreference: 'adaptive' | 'light' | 'dark', nextThemeProfiles: ThemeProfilesLocalStateV1) => {
        const systemTheme = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
        void runThemePreferenceChange({
            currentPreference: themePreference,
            nextPreference: nextThemePreference,
            platform: Platform.OS,
            reduceMotion,
            forceAnimate: true,
            systemTheme,
            mutation: () => {
                setThemePreference(nextThemePreference);
                setThemeProfiles(nextThemeProfiles);
                applyThemeRuntimeSelection({
                    themePreference: nextThemePreference,
                    themeProfiles: nextThemeProfiles,
                    systemTheme,
                });
                setStatusBarStyle(resolveStatusBarStyleForThemePreference(nextThemePreference, systemTheme), true);
            },
        });
    }, [reduceMotion, setThemePreference, setThemeProfiles, themePreference]);

    /** 选择基础或自定义主题时仅更新对应模式的主题配置。 */
    const selectCurrentTheme = React.useCallback((option: ThemeSelectionOption) => {
        if (option.kind === 'adaptive') {
            applyThemeSelection('adaptive', safeThemeProfiles);
            return;
        }

        applyThemeSelection(
            option.preferredMode,
            setActiveThemeProfileForMode(
                safeThemeProfiles,
                option.preferredMode,
                option.kind === 'base' ? null : option.id,
            ),
        );
    }, [applyThemeSelection, safeThemeProfiles]);

    const phoneActiveThemeProfile = themePreference === 'light' ? activeLightThemeProfile
        : themePreference === 'dark' ? activeDarkThemeProfile : null;
    const phoneThemeSubtitle = phoneActiveThemeProfile
        ? isBuiltInThemeProfilePresetId(phoneActiveThemeProfile.id)
            ? t('settingsAppearance.themeProfiles.active')
            : phoneActiveThemeProfile.name
        : undefined;

    // 手机只显示三种模式，选项及实际写入继续使用原主题 owner；挂载不重写旧配置。
    const phoneThemeOptions = React.useMemo(() => isPhoneLayout
        ? buildCurrentThemeSelectionOptions(safeThemeProfiles).filter((option) => option.kind === 'adaptive' || option.kind === 'base')
        : [], [isPhoneLayout, safeThemeProfiles]);

    /** 手机主题选择沿用原主题变更和减少动态效果处理。 */
    const selectPhoneTheme = React.useCallback((id: string) => {
        const option = phoneThemeOptions.find((candidate) => candidate.id === id);
        if (option) selectCurrentTheme(option);
        setOpenThemeMenu(false);
    }, [phoneThemeOptions, selectCurrentTheme]);

    const selectThemeProfileForMode = React.useCallback((mode: ThemeProfileMode, profileId: string | null) => {
        applyThemeSelection(themePreference, setActiveThemeProfileForMode(safeThemeProfiles, mode, profileId));
    }, [applyThemeSelection, safeThemeProfiles, themePreference]);

    // Ensure we have a valid style for display, defaulting to gradient for unknown values
    const displayStyle = normalizeAvatarStyleId(avatarStyle);
    
    return (
        <ItemList style={{ paddingTop: 0, backgroundColor: isPhoneLayout ? theme.colors.surface.base : theme.colors.background.canvas }}>

            {/* Theme Settings */}
            <SettingsSection compact={isPhoneLayout} title={isPhoneLayout ? undefined : t('settingsAppearance.theme')} footer={isPhoneLayout ? undefined : t('settingsAppearance.themeDescription')}>
                {isPhoneLayout ? <DropdownMenu
                    open={openThemeMenu}
                    onOpenChange={setOpenThemeMenu}
                    selectedId={themePreference}
                    items={phoneThemeOptions.map((option) => ({ id: option.id, title: option.title }))}
                    onSelect={selectPhoneTheme}
                    variant="selectable"
                    search={false}
                    rowKind="item"
                    itemTrigger={{
                        title: t('settingsAppearance.theme'),
                        subtitle: phoneThemeSubtitle,
                        showSelectedSubtitle: false,
                        showSelectedDetail: true,
                        itemProps: { testID: 'settings-theme-selector-trigger', density: 'cozy', titleLines: 0, style: { minHeight: 48 } },
                    }}
                /> : <ThemeSelectionDropdown
                    open={openThemeMenu}
                    onOpenChange={setOpenThemeMenu}
                    variant="current"
                    themePreference={themePreference}
                    themeProfiles={safeThemeProfiles}
                    onSelectTheme={selectCurrentTheme}
                />}
                {!isPhoneLayout && themePreference === 'adaptive' ? (
                    <>
                        <ThemeSelectionDropdown
                            open={openLightThemeMenu}
                            onOpenChange={setOpenLightThemeMenu}
                            variant="slot"
                            mode="light"
                            themeProfiles={safeThemeProfiles}
                            onSelectProfile={(profileId) => selectThemeProfileForMode('light', profileId)}
                        />
                        <ThemeSelectionDropdown
                            open={openDarkThemeMenu}
                            onOpenChange={setOpenDarkThemeMenu}
                            variant="slot"
                            mode="dark"
                            themeProfiles={safeThemeProfiles}
                            onSelectProfile={(profileId) => selectThemeProfileForMode('dark', profileId)}
                        />
                    </>
                ) : null}
                {!isPhoneLayout ? <Item
                    testID="settings-appearance-themeProfiles"
                    title={t('settingsAppearance.themeProfiles.title')}
                    subtitle={activeThemeProfilesSubtitle}
                    icon={<Icon name="palette" size={29} color={theme.colors.accent.indigo} />}
                    detail={activeLightThemeProfile || activeDarkThemeProfile
                        ? t('settingsAppearance.themeProfiles.active')
                        : t('settingsAppearance.themeProfiles.defaultTheme')}
                    onPress={() => router.push('/settings/appearance/themes')}
                /> : null}
            </SettingsSection>

            {/* Text Settings */}
            <SettingsSection compact={isPhoneLayout} title={isPhoneLayout ? undefined : t('settingsAppearance.text')} footer={isPhoneLayout ? undefined : t('settingsAppearance.textDescription')}>
                <DropdownMenu
                    open={openTextSizeMenu}
                    onOpenChange={setOpenTextSizeMenu}
                    variant="selectable"
                    search={false}
                    selectedId={selectedTextSizeId}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    itemTrigger={{
                        title: t('settingsAppearance.textSize'),
                        subtitle: isPhoneLayout ? undefined : t('settingsAppearance.textSizeDescription'),
                        itemProps: isPhoneLayout ? { density: 'cozy', titleLines: 0, style: { minHeight: 48 } } : undefined,
                        icon: <Icon name="text-aa" size={29} color={theme.colors.accent.orange} />,
                        showSelectedSubtitle: false,
                    }}
                    items={textSizeMenuItems}
                    onSelect={selectUiFontSize}
                />
                {!isPhoneLayout ? (
                <DropdownMenu
                    open={openItemDensityMenu}
                    onOpenChange={setOpenItemDensityMenu}
                    variant="selectable"
                    search={false}
                    selectedId={uiItemDensity}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    itemTrigger={{
                        title: t('settingsAppearance.itemDensity'),
                        subtitle: t('settingsAppearance.itemDensityDescription'),
                        icon: <Icon name="list" size={29} color={theme.colors.accent.orange} />,
                        showSelectedSubtitle: false,
                    }}
                    items={itemDensityMenuItems}
                    onSelect={(itemId) => {
                        if (!isUiItemDensity(itemId)) return;
                        setUiItemDensity(itemId);
                    }}
                />
                ) : null}
            </SettingsSection>

            {/* 桌面与平板保留原面板、材质和导航个性化。 */}
            {!isPhoneLayout ? <>
            {/* Layout */}
            <SettingsSection compact={isPhoneLayout} title={t('settingsAppearance.display')} footer={t('settingsAppearance.displayDescription')}>
                <DropdownMenu
                    open={openContentWidthMenu}
                    onOpenChange={setOpenContentWidthMenu}
                    variant="selectable"
                    search={false}
                    selectedId={uiContentWidthMode}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    itemTrigger={{
                        title: t('settingsAppearance.contentWidth'),
                        subtitle: t('settingsAppearance.contentWidthDescription'),
                        icon: <Icon name="resize" size={29} color={theme.colors.accent.blue} />,
                        showSelectedSubtitle: false,
                    }}
                    items={contentWidthMenuItems}
                    onSelect={(itemId) => {
                        if (itemId !== 'compact' && itemId !== 'medium' && itemId !== 'full') return;
                        setUiContentWidthMode(itemId);
                    }}
                />
                <Item
                    title={t('settingsAppearance.multiPanePanels')}
                    subtitle={t('settingsAppearance.multiPanePanelsDescription')}
                    icon={<Icon name="browsers" size={29} color={theme.colors.accent.blue} />}
                    rightElement={
                        <Switch
                            value={uiMultiPanePanelsEnabled}
                            onValueChange={setUiMultiPanePanelsEnabled}
                            disabled={!panelsSupported}
                        />
                    }
                    disabled={!panelsSupported}
                    showChevron={false}
                />
                <Item
                    title={t('settingsAppearance.backdropBlur')}
                    subtitle={t('settingsAppearance.backdropBlurDescription')}
                    icon={<Icon name="stack-simple" size={29} color={theme.colors.accent.blue} />}
                    rightElement={
                        <Switch
                            value={uiBackdropBlurEnabled !== false}
                            onValueChange={setUiBackdropBlurEnabled}
                        />
                    }
                    showChevron={false}
                />
                <DropdownMenu
                    open={openDetailsTabsMenu}
                    onOpenChange={setOpenDetailsTabsMenu}
                    variant="selectable"
                    search={false}
                    selectedId={detailsPaneTabsBehavior}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    itemTrigger={{
                        title: t('settingsAppearance.detailsPaneTabsBehavior'),
                        subtitle: t('settingsAppearance.detailsPaneTabsBehaviorDescription'),
                        icon: <Icon name="stack" size={29} color={theme.colors.accent.blue} />,
                        showSelectedSubtitle: false,
                        itemProps: { disabled: !panelsSupported },
                    }}
                    items={detailsTabsMenuItems}
                    onSelect={(itemId) => {
                        if (!isDetailsPaneTabsBehavior(itemId)) return;
                        setDetailsPaneTabsBehavior(itemId);
                    }}
                />
            </SettingsSection>

            {/* Style */}
            <SettingsSection compact={isPhoneLayout} title={t('settingsAppearance.avatarStyle')}>
                <DropdownMenu
                    open={openAvatarStyleMenu}
                    onOpenChange={setOpenAvatarStyleMenu}
                    variant="selectable"
                    search={false}
                    selectedId={displayStyle}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    itemTrigger={{
                        title: t('settingsAppearance.avatarStyle'),
                        subtitle: t('settingsAppearance.avatarStyleDescription'),
                        icon: <AvatarStylePreviewIcon styleId={displayStyle} />,
                        showSelectedSubtitle: false,
                        itemProps: { testID: 'settings-appearance-avatarStyle-select' },
                    }}
                    items={avatarStyleMenuItems}
                    onSelect={(itemId) => {
                        if (!isAvatarStyleId(itemId)) return;
                        setAvatarStyle(itemId);
                    }}
                />
                <Item
                    title={t('settingsAppearance.showFlavorIcons')}
                    subtitle={t('settingsAppearance.showFlavorIconsDescription')}
                    icon={<Icon name="squares-four" size={29} color={theme.colors.accent.indigo} />}
                    rightElement={
                        <Switch
                            value={showFlavorIcons}
                            onValueChange={setShowFlavorIcons}
                        />
                    }
                />
            </SettingsSection>

            {/* Tab bar appearance */}
            <SettingsSection compact={isPhoneLayout} title={t('settingsAppearance.tabBarAppearance.title')} footer={t('settingsAppearance.tabBarAppearance.footer')}>
                <DropdownMenu
                    open={openTabBarSizeMenu}
                    onOpenChange={setOpenTabBarSizeMenu}
                    variant="selectable"
                    search={false}
                    selectedId={tabBarSize}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    itemTrigger={{
                        title: t('settingsAppearance.tabBarAppearance.size'),
                        icon: <Icon name="resize" size={29} color={theme.colors.accent.blue} />,
                        showSelectedSubtitle: false,
                        itemProps: { testID: 'settings-appearance-tabBarSize-select' },
                    }}
                    items={tabBarSizeMenuItems}
                    onSelect={(itemId) => {
                        if (itemId !== 'compact' && itemId !== 'regular' && itemId !== 'large') return;
                        setTabBarSize(itemId);
                    }}
                />
                <Item
                    title={t('settingsAppearance.tabBarAppearance.showLabels')}
                    icon={<Icon name="text-aa" size={29} color={theme.colors.accent.blue} />}
                    rightElement={
                        <Switch
                            testID="settings-appearance-tabBarShowLabels-switch"
                            value={tabBarShowLabels}
                            onValueChange={setTabBarShowLabels}
                        />
                    }
                    showChevron={false}
                />
            </SettingsSection>

            {/* Glass surfaces */}
            <SettingsSection compact={isPhoneLayout} title={t('settingsAppearance.glass.title')} footer={t('settingsAppearance.glass.footer')}>
                <Item
                    title={t('settingsAppearance.glass.enable')}
                    icon={<Icon name="circle-half" size={29} color={theme.colors.accent.blue} />}
                    rightElement={
                        <Switch
                            testID="settings-appearance-glassBlur-switch"
                            value={glassBlurEnabled}
                            onValueChange={setGlassBlurEnabled}
                        />
                    }
                    showChevron={false}
                />
                {glassBlurEnabled ? (
                    <DropdownMenu
                        open={openGlassBlurMenu}
                        onOpenChange={setOpenGlassBlurMenu}
                        variant="selectable"
                        search={false}
                        selectedId={glassBlurIntensity}
                        showCategoryTitles={false}
                        matchTriggerWidth={true}
                        connectToTrigger={true}
                        rowKind="item"
                        itemTrigger={{
                            title: t('settingsAppearance.glass.intensity'),
                            icon: <Icon name="sliders-horizontal" size={29} color={theme.colors.accent.blue} />,
                            showSelectedSubtitle: false,
                            itemProps: { testID: 'settings-appearance-glassBlurIntensity-select' },
                        }}
                        items={glassBlurIntensityMenuItems}
                        onSelect={(itemId) => {
                            if (itemId !== 'light' && itemId !== 'regular' && itemId !== 'strong') return;
                            setGlassBlurIntensity(itemId);
                        }}
                    />
                ) : null}
            </SettingsSection>

            {/* Tab bar badges */}
            <SettingsSection compact={isPhoneLayout} title={t('settingsAppearance.tabBarBadges.title')} footer={t('settingsAppearance.tabBarBadges.footer')}>
                <DropdownMenu
                    open={openGitBadgeMenu}
                    onOpenChange={setOpenGitBadgeMenu}
                    variant="selectable"
                    search={false}
                    selectedId={tabBarGitBadgeMode}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    itemTrigger={{
                        title: t('settingsAppearance.tabBarBadges.gitTitle'),
                        icon: <Icon name="git-branch" size={29} color={theme.colors.accent.blue} />,
                        showSelectedSubtitle: false,
                        itemProps: { testID: 'settings-appearance-tabBarGitBadge-select' },
                    }}
                    items={gitBadgeMenuItems}
                    onSelect={(itemId) => {
                        if (itemId !== 'changedFiles' && itemId !== 'diffLines' && itemId !== 'off') return;
                        setTabBarGitBadgeMode(itemId);
                    }}
                />
                <Item
                    title={t('tabs.friends')}
                    icon={<Icon name="users" size={29} color={theme.colors.accent.blue} />}
                    rightElement={
                        <Switch
                            testID="settings-appearance-tabBarFriendsBadge-switch"
                            value={tabBarFriendsBadgeEnabled}
                            onValueChange={setTabBarFriendsBadgeEnabled}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('tabs.inbox')}
                    icon={<Icon name="envelope" size={29} color={theme.colors.accent.blue} />}
                    rightElement={
                        <Switch
                            testID="settings-appearance-tabBarInboxBadge-switch"
                            value={tabBarInboxBadgeEnabled}
                            onValueChange={setTabBarInboxBadgeEnabled}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('workspaceCockpit.tabs')}
                    icon={<Icon name="stack" size={29} color={theme.colors.accent.blue} />}
                    rightElement={
                        <Switch
                            testID="settings-appearance-tabBarOpenTabsBadge-switch"
                            value={tabBarOpenTabsBadgeEnabled}
                            onValueChange={setTabBarOpenTabsBadgeEnabled}
                        />
                    }
                    showChevron={false}
                />
            </SettingsSection>
            </> : null}
        </ItemList>
    );
});
