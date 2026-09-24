import { View, Pressable, Platform, Linking, useWindowDimensions } from 'react-native';
import { BrandLogo } from '@/components/ui/navigation/BrandLogo';
import { BrandWordmark } from '@/components/onboarding/unauthShell/BrandWordmark';
import * as React from 'react';
import { Text } from '@/components/ui/text/Text';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { Typography } from "@/constants/Typography";
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { ItemList } from '@/components/ui/lists/ItemList';
import { useConnectTerminal } from '@/hooks/session/useConnectTerminal';
import { useAuth } from '@/auth/context/AuthContext';
import { useEntitlement, useLocalSettingMutable, useSetting, useProfile } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { trackPaywallButtonClicked } from '@/track';
import { Modal } from '@/modal';
import { useMultiClick } from '@/hooks/ui/useMultiClick';
import { useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/ui/layout/layout';
import { useHappyAction } from '@/hooks/ui/useHappyAction';
import { getDisplayName, getAvatarUrl, getBio } from '@/sync/domains/profiles/profile';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { t } from '@/text';
import { canRequestReview, requestReview } from '@/utils/system/requestReview';
import { DEFAULT_AGENT_ID, getAgentCore, resolveAgentIdFromConnectedServiceId } from '@/agents/catalog/catalog';
import { AgentIcon } from '@/agents/registry/AgentIcon';
import { resolveSupportUsAction } from '@/components/settings/supportUsBehavior';
import { recordBugReportUserAction } from '@/utils/system/bugReportActionTrail';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { useAutomationsSupport } from '@/hooks/server/useAutomationsSupport';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useScannedAuthUrlProcessor } from '@/hooks/auth/useScannedAuthUrlProcessor';
import type { FeatureId } from '@happier-dev/protocol';
import { getFeatureBuildPolicyDecision } from '@/sync/domains/features/featureBuildPolicy';
import { isRunningOnMac } from '@/utils/platform/platform';
import { isWebMobileLikeQrScannerHost } from '@/utils/platform/webMobileHeuristics';
import { navigateWithBlurOnWeb } from '@/utils/platform/navigateWithBlurOnWeb';
import { deferOnWeb } from '@/utils/platform/deferOnWeb';
import { isTauriDesktop } from '@/utils/platform/tauri';
import { DesktopSettingsSection } from '@/components/settings/desktop/DesktopSettingsSection';
import { useDeviceType } from '@/utils/platform/responsive';
import { SettingsBelowFoldSections } from '@/components/settings/SettingsBelowFoldSections';
import { runAfterInteractionsWithFallback } from '@/utils/timing/runAfterInteractionsWithFallback';
import { Icon } from '@/components/ui/icons/Icon';

const DEFER_BELOW_FOLD_SETTINGS_SECTIONS_DELAY_MS = 0;
const DEFER_BELOW_FOLD_SETTINGS_STAGE_DELAY_MS = 16;

/** 手机突出账号、通知与关于，桌面继续使用完整设置分类。 */
export const SettingsView = React.memo(function SettingsView() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { width, height } = useWindowDimensions();
    const appVersion = Constants.expoConfig?.version || '1.0.0';
    const auth = useAuth();
    const isPhoneSizedWeb = Platform.OS === 'web' && isWebMobileLikeQrScannerHost({ width, height });
    const deviceType = useDeviceType();
    const isPhoneLayout = !isRunningOnMac() && !isTauriDesktop()
        && (Platform.OS === 'web' ? isPhoneSizedWeb : deviceType === 'phone');
    const [devModeEnabled, setDevModeEnabled] = useLocalSettingMutable('devModeEnabled');
    const voiceEntitlement = useEntitlement('voice');
    const isPro = __DEV__ || voiceEntitlement;
    const usageReportingEnabled = useFeatureEnabled('usage.reporting');
    const executionRunsEnabled = useFeatureEnabled('execution.runs');
    const connectedServicesEnabled = useFeatureEnabled('connectedServices');
    const memorySearchEnabled = useFeatureEnabled('memory.search');
    const voiceEnabled = useFeatureEnabled('voice');
    const sourceControlEnabled = useFeatureEnabled('scm.writeOperations');
    const attachmentsUploadsEnabled = useFeatureEnabled('attachments.uploads');
    const promptsLibraryEnabled = useFeatureEnabled('prompts.library');
    const mcpServersEnabled = useFeatureEnabled('mcp.servers');
    const petsCompanionEnabled = useFeatureEnabled('pets.companion');
    const petsSyncEnabled = useFeatureEnabled('pets.sync');
    const showChangelog = getFeatureBuildPolicyDecision('app.ui.changelog' as const satisfies FeatureId) !== 'deny';
    const [showRateUs, setShowRateUs] = React.useState(false);
    const useProfiles = useSetting('useProfiles');
    const terminalUseTmux = useSetting('sessionUseTmux');
    const automationsSupport = useAutomationsSupport();
    const showAutomations = automationsSupport?.discoverable !== false;
    const automationsNeedLocalEnablement = automationsSupport?.blockedBy === 'local_policy';
    const profile = useProfile();
    const displayName = getDisplayName(profile);
    const avatarUrl = getAvatarUrl(profile);
    const bio = getBio(profile);
    const pushRoute = React.useCallback((route: Parameters<typeof router.push>[0]) => {
        deferOnWeb(() => {
            navigateWithBlurOnWeb(() => {
                router.push(route);
            });
        });
    }, [router]);

    const anthropicAgentId = resolveAgentIdFromConnectedServiceId('anthropic') ?? DEFAULT_AGENT_ID;
    const anthropicAgentCore = getAgentCore(anthropicAgentId);

    const showHiddenSettingsButtons = devModeEnabled;
    const showDesktopSettings = isTauriDesktop();
    const [belowFoldSettingsStage, setBelowFoldSettingsStage] = React.useState(0);
    const { connectTerminal, isLoading } = useConnectTerminal();
    const { processAuthUrl: processScannedAuthUrl } = useScannedAuthUrlProcessor();

    useFocusEffect(
        React.useCallback(() => {
            fireAndForget(sync.refreshMachinesThrottled({ staleMs: 30_000 }), { tag: 'SettingsView.refreshMachinesThrottled' });
        }, [])
    );

    React.useEffect(() => {
        if (belowFoldSettingsStage >= 4) return undefined;

        const nextStage = belowFoldSettingsStage + 1;
        const delayMs = belowFoldSettingsStage === 0
            ? DEFER_BELOW_FOLD_SETTINGS_SECTIONS_DELAY_MS
            : DEFER_BELOW_FOLD_SETTINGS_STAGE_DELAY_MS;
        let cancelStageTimer: (() => void) | undefined;

        const scheduleNextStage = () => {
            const timer = setTimeout(() => {
                setBelowFoldSettingsStage((currentStage) => Math.max(currentStage, nextStage));
            }, delayMs);
            cancelStageTimer = () => clearTimeout(timer);
        };

        if (belowFoldSettingsStage === 0) {
            const cancelInteractions = runAfterInteractionsWithFallback(scheduleNextStage);
            return () => {
                cancelStageTimer?.();
                cancelInteractions();
            };
        }

        scheduleNextStage();
        return () => {
            cancelStageTimer?.();
        };
    }, [belowFoldSettingsStage]);

    React.useEffect(() => {
        let cancelled = false;

        const refreshRateUsAvailability = async () => {
            let available = false;
            try {
                available = await canRequestReview();
            } catch {
                available = false;
            }
            if (!cancelled) {
                setShowRateUs(available);
            }
        };

        void refreshRateUsAvailability();

        return () => {
            cancelled = true;
        };
    }, []);

    const handleGitHub = async () => {
        const url = 'https://github.com/happier-dev/happier';
        const supported = await Linking.canOpenURL(url);
        if (supported) {
            await Linking.openURL(url);
        }
    };

    const handleReportIssue = async () => {
        recordBugReportUserAction('settings.report_issue_open');
        const overrideUrl = String(process.env.EXPO_PUBLIC_HAPPIER_REPORT_ISSUE_URL ?? '').trim();
        if (overrideUrl.length > 0) {
            const supported = await Linking.canOpenURL(overrideUrl);
            if (supported) {
                await Linking.openURL(overrideUrl);
                return;
            }
        }
        pushRoute('/settings/report-issue');
    };

    const handleSubscribe = async () => {
        trackPaywallButtonClicked();
        const result = await sync.presentPaywall();
        if (!result.success) {
            Modal.alert(t('common.error'), result.error || t('errors.unknownError'));
        }
    };

    const handleSupportUs = async () => {
        const action = resolveSupportUsAction({ isPro });
        if (action === 'github') {
            await handleGitHub();
            return;
        }
        await handleSubscribe();
    };

    // Use the multi-click hook for version clicks
    const handleVersionClick = useMultiClick(() => {
        // Toggle dev mode
        const newDevMode = !devModeEnabled;
        setDevModeEnabled(newDevMode);
        Modal.alert(
            t('modals.developerMode'),
            newDevMode ? t('modals.developerModeEnabled') : t('modals.developerModeDisabled')
        );
    }, {
        requiredClicks: 10,
        resetTimeout: 2000,
    });

    // Connection status
    const isAnthropicConnected = profile.connectedServices?.includes('anthropic') || false;

    // Anthropic connection
    const [connectingAnthropic, connectAnthropic] = useHappyAction(async () => {
        const route = anthropicAgentCore.uiConnectedService.connectRoute;
        if (route) {
            pushRoute(route);
        }
    });

    // 复用原连接行为；手机只是调整入口所在分组。
    const connectTerminalItems = React.useMemo(() => (
        <>
            <Item
                testID="settings-connect-terminal-scan"
                title={t('settingsAccount.linkNewDevice')}
                icon={<Icon name="qr-code" size={29} color={theme.colors.accent.blue} />}
                onPress={connectTerminal}
                loading={isLoading}
                showChevron={false}
            />
            <Item
                testID="settings-connect-terminal-enter-url"
                title={t('connect.enterUrlManually')}
                icon={<Icon name="link" size={29} color={theme.colors.accent.blue} />}
                onPress={async () => {
                    const url = await Modal.prompt(
                        t('connect.linkNewDeviceTitle'),
                        undefined,
                        {
                            confirmText: t('common.continue'),
                            cancelText: t('common.cancel'),
                        }
                    );
                    if (url?.trim()) {
                        processScannedAuthUrl(url.trim());
                    }
                }}
                showChevron={false}
            />
        </>
    ), [connectTerminal, isLoading, processScannedAuthUrl, theme.colors.accent.blue]);

    // 手机将低频账号选项放进更多设置，桌面保留原位置与稳定节点。
    const accountPreferenceItems = React.useMemo(() => (
        <>
            {useProfiles && (
                <Item
                    title={t('settings.secrets')}
                    subtitle={t('settings.secretsSubtitle')}
                    icon={<Icon name="key" size={29} color={theme.colors.accent.purple} />}
                    onPress={() => router.push('/settings/secrets')}
                />
            )}
            {usageReportingEnabled && (
                <Item
                    title={t('settings.usage')}
                    subtitle={t('settings.usageSubtitle')}
                    icon={<Icon name="chart-line" size={29} color={theme.colors.accent.blue} />}
                    onPress={() => router.push('/settings/usage')}
                />
            )}
        </>
    ), [router, theme.colors.accent.blue, theme.colors.accent.purple, usageReportingEnabled, useProfiles]);

    const profileAndAccountSection = React.useMemo(() => (
        <ItemGroup title={isPhoneLayout ? undefined : t('settings.profileAndAccount')}>
            <Item
                title={t('settings.account')}
                subtitle={isPhoneLayout && profile.firstName ? displayName : t('settings.accountSubtitle')}
                icon={<Icon name="user-circle" size={29} color={theme.colors.accent.blue} />}
                onPress={() => router.push('/settings/account')}
            />
            {!isPhoneLayout ? accountPreferenceItems : null}
            {!isPhoneLayout ? <Item
                title={t('settings.machines')}
                icon={<Icon name="desktop" size={29} color={theme.colors.accent.orange} />}
                onPress={() => pushRoute('/settings/machines')}
            /> : null}

        </ItemGroup>
    ), [isPhoneLayout, profile.firstName, displayName, accountPreferenceItems, pushRoute, router, theme]);

    const generalSection = React.useMemo(() => (
        <ItemGroup title={t('settings.general')}>
            {!isPhoneLayout ? <Item
                title={t('settings.appearance')}
                subtitle={t('settings.appearanceSubtitle')}
                icon={<Icon name="palette" size={29} color={theme.colors.accent.indigo} />}
                onPress={() => pushRoute('/settings/appearance')}
            /> : null}
            <Item
                title={t('settings.featuresTitle')}
                subtitle={t('settings.featuresSubtitle')}
                icon={<Icon name="flask" size={29} color={theme.colors.accent.orange} />}
                onPress={() => pushRoute('/settings/features')}
            />
            <Item
                testID="settings-keyboard-shortcuts-row"
                title={t('settingsKeyboard.title')}
                subtitle={t('settingsKeyboard.entrySubtitle')}
                icon={<Icon name="squares-four" size={29} color={theme.colors.accent.blue} />}
                onPress={() => pushRoute('/settings/keyboard')}
            />
            {petsCompanionEnabled || petsSyncEnabled ? (
                <Item
                    testID="settings-pets-row"
                    title={t('settings.pets')}
                    subtitle={t('settings.petsSubtitle')}
                    icon={<Icon name="paw-print" size={29} color={theme.colors.accent.green} />}
                    onPress={() => pushRoute('/settings/pets')}
                />
            ) : null}
        </ItemGroup>
    ), [
        petsCompanionEnabled,
        petsSyncEnabled,
        pushRoute,
        theme.colors.accent.blue,
        theme.colors.accent.green,
        theme.colors.accent.indigo,
        theme.colors.accent.orange,
        isPhoneLayout,
    ]);

    // 保持常用设置节点稳定，后台状态刷新不重建正在阅读的条目。
    const phoneAccountSection = React.useMemo(() => (
        <SettingsSection compact>
            <Item
                testID="settings-phone-account"
                title={displayName || t('settings.account')}
                subtitle={t(auth.isAuthenticated ? 'server.signedIn' : 'server.signedOut')}
                titleLines={0}
                subtitleLines={0}
                density="cozy"
                iconBoxSize={40}
                icon={<Avatar id={profile.id} size={32} imageUrl={avatarUrl} thumbhash={profile.avatar?.thumbhash} />}
                onPress={() => pushRoute('/settings/account')}
            />
        </SettingsSection>
    ), [displayName, auth.isAuthenticated, profile.id, profile.avatar?.thumbhash, avatarUrl, pushRoute]);

    // 常用行允许大字体自然换行，入口仍交给原详情页处理。
    const phoneGeneralSection = React.useMemo(() => (
        <SettingsSection compact>
            <Item
                density="cozy"
                titleLines={0}
                style={{ minHeight: 48 }}
                testID="settings-notifications-row"
                title={t('settings.notifications')}
                icon={<Icon name="bell" size={22} color={theme.colors.text.secondary} />}
                onPress={() => pushRoute('/settings/notifications')}
            />
            <Item
                density="cozy"
                titleLines={0}
                style={{ minHeight: 48 }}
                title={t('settings.appearance')}
                icon={<Icon name="palette" size={22} color={theme.colors.text.secondary} />}
                onPress={() => pushRoute('/settings/appearance')}
            />
            <Item
                density="cozy"
                titleLines={0}
                style={{ minHeight: 48 }}
                testID="settings-connection-row"
                title={t('settings.connectionSettings')}
                icon={<Icon name="link" size={22} color={theme.colors.text.secondary} />}
                onPress={() => pushRoute('/settings/server')}
            />
        </SettingsSection>
    ), [pushRoute, theme.colors.text.secondary]);

    return (
        <ItemList style={{ paddingTop: 0, backgroundColor: isPhoneLayout ? theme.colors.surface.base : theme.colors.background.canvas }}>
            {/* 手机用实际账号入口，桌面保留原品牌与版本展示。 */}
            {isPhoneLayout ? phoneAccountSection : <View style={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}>
                <View style={{ alignItems: 'center', paddingVertical: 24, backgroundColor: theme.colors.surface.base, marginTop: 16, borderRadius: 12, marginHorizontal: 16 }}>
                    {profile.firstName ? (
                        // Profile view: Avatar + name + version
                        <>
                            <View style={{ marginBottom: 12 }}>
                                <Avatar
                                    id={profile.id}
                                    size={90}
                                    imageUrl={avatarUrl}
                                    thumbhash={profile.avatar?.thumbhash}
                                />
                            </View>
                            <Text style={{ fontSize: 20, fontWeight: '600', color: theme.colors.text.primary, marginBottom: bio ? 4 : 8 }}>
                                {displayName}
                            </Text>
                            {bio && (
                                <Text style={{ fontSize: 14, color: theme.colors.text.secondary, textAlign: 'center', marginBottom: 8, paddingHorizontal: 16 }}>
                                    {bio}
                                </Text>
                            )}
                        </>
                    ) : (
                        // 桌面保留原占位尺寸，只替换品牌内容。
                        <>
                            <View style={{ width: 300, height: 90, alignItems: 'center', justifyContent: 'center' }}>
                                <BrandWordmark height={40} />
                            </View>
                        </>
                    )}
                </View>
            </View>}

            {/* Add your phone (desktop/web only) */}
            {(isRunningOnMac() || (Platform.OS === 'web' && !isPhoneSizedWeb)) &&
            auth.isAuthenticated ? (
                <ItemGroup>
                    <Item
                        testID="settings-add-your-phone-shortcut"
                        title={t('settings.addYourPhone')}
                        subtitle={t('settings.addYourPhoneSubtitle')}
                        icon={<Icon name="device-mobile" size={29} color={theme.colors.accent.blue} />}
                        onPress={() => router.push('/settings/add-phone')}
                    />
                </ItemGroup>
            ) : null}

            {showDesktopSettings ? <DesktopSettingsSection /> : null}

            {/* 平板等原布局继续使用独立连接分组；手机归入账号与连接。 */}
            {!isPhoneLayout && !isRunningOnMac() && (Platform.OS !== 'web' || isPhoneSizedWeb) ? (
                <ItemGroup>{connectTerminalItems}</ItemGroup>
            ) : null}

            {/* Hidden / unfinished buttons (toggle via Developer Mode) */}
            {showHiddenSettingsButtons && !isPhoneLayout && (
                <>
                    {/* Support Us */}
                    <ItemGroup>
                        <Item
                            title={t('settings.supportUs')}
                            subtitle={isPro ? t('settings.supportUsSubtitlePro') : t('settings.supportUsSubtitle')}
                            icon={<Icon name="heart" size={29} color={theme.colors.state.danger.foreground} />}
                            showChevron={false}
                            onPress={handleSupportUs}
                        />
                    </ItemGroup>

                    <ItemGroup title={t('settings.connectedAccounts')}>
                        <Item
                            title={anthropicAgentCore.uiConnectedService.label}
                            subtitle={isAnthropicConnected
                                ? t('settingsAccount.statusActive')
                                : t('settings.connectAccount')
                            }
                            icon={
                                <AgentIcon agentId={anthropicAgentId} size={29} />
                            }
                            onPress={isAnthropicConnected
                                ? () => pushRoute({
                                    pathname: '/settings/connected-services/[serviceId]',
                                    params: { serviceId: 'anthropic' },
                                })
                                : connectAnthropic}
                            loading={connectingAnthropic}
                        />
                    </ItemGroup>
                </>
            )}

            {/* Social */}
            {/* <ItemGroup title={t('settings.social')}>
                <Item
                    title={t('navigation.friends')}
                    subtitle={t('friends.manageFriends')}
                    icon={<Icon name="users" size={29} color={theme.colors.accent.blue} />}
                    onPress={() => router.push('/friends')}
                />
            </ItemGroup> */}

            {/* Profile & Account */}
            {!isPhoneLayout ? profileAndAccountSection : null}

            {isPhoneLayout ? phoneGeneralSection : generalSection}

            {belowFoldSettingsStage > 0 ? (
                <SettingsBelowFoldSections
                    compact={isPhoneLayout}
                    appVersion={appVersion}
                    attachmentsUploadsEnabled={attachmentsUploadsEnabled}
                    automationsNeedLocalEnablement={automationsNeedLocalEnablement}
                    connectedServicesEnabled={connectedServicesEnabled}
                    devModeEnabled={devModeEnabled}
                    executionRunsEnabled={executionRunsEnabled}
                    handleGitHub={handleGitHub}
                    handleReportIssue={handleReportIssue}
                    handleVersionClick={handleVersionClick}
                    mcpServersEnabled={mcpServersEnabled}
                    memorySearchEnabled={memorySearchEnabled}
                    promptsLibraryEnabled={promptsLibraryEnabled}
                    router={router}
                    showAutomations={showAutomations}
                    showChangelog={showChangelog}
                    showRateUs={showRateUs}
                    sourceControlEnabled={sourceControlEnabled}
                    stage={belowFoldSettingsStage}
                    terminalUseTmux={terminalUseTmux}
                    theme={theme}
                    useProfiles={useProfiles}
                    voiceEnabled={voiceEnabled}
                />
            ) : null}

        </ItemList>
    );
});
