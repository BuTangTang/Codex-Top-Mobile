import * as React from 'react';
import { Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { useDeviceType } from '@/utils/platform/responsive';
import { useRouter } from 'expo-router';

import { ItemList } from '@/components/ui/lists/ItemList';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { RelayDriftActionCard } from '@/components/settings/server/RelayDriftActionCard';
import { isTauriDesktop } from '@/utils/platform/tauri';
import { t } from '@/text';

import { DesktopOnlySetupNotice } from './DesktopOnlySetupNotice';
import { MachineSetupActionsSection } from './MachineSetupActionsSection';
import { MachinesListSection } from './MachinesListSection';
import { useMachinesSettingsViewModel } from './machinesSettingsViewModel';

/** 电脑页展示真实连接列表，手机使用平面紧凑背景，桌面保留安装与维护入口。 */
export const MachinesSettingsView = React.memo(function MachinesSettingsView() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const deviceType = useDeviceType();
    const isPhone = Platform.OS !== 'web' && deviceType === 'phone';
    const viewModel = useMachinesSettingsViewModel();
    const isDesktop = isTauriDesktop();
    const isBrowserWeb = Platform.OS === 'web' && !isDesktop;

    return (
        <ItemList style={isPhone ? { backgroundColor: theme.colors.surface.base } : undefined}>
            {viewModel.relayDriftBanner ? (
                isDesktop ? (
                    <RelayDriftActionCard banner={viewModel.relayDriftBanner} />
                ) : (
                    <ItemGroup title={viewModel.relayDriftBanner.title}>
                        <Item
                            testID="settings.machines.relayDrift.webNotice"
                            title={viewModel.relayDriftBanner.title}
                            subtitle={viewModel.relayDriftBanner.description}
                            showChevron={false}
                            mode="info"
                        />
                    </ItemGroup>
                )
            ) : null}
            <MachinesListSection
                viewModel={viewModel}
                onOpenMachine={(machineId, serverId) => {
                    const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : '';
                    router.push(`/(app)/machine/${machineId}${query}`);
                }}
            />
            {isDesktop ? (
                <MachineSetupActionsSection />
            ) : isBrowserWeb ? (
                <DesktopOnlySetupNotice
                    testID="settings.machines.desktopOnlySetupNotice"
                    groupTitle={t('settings.addMachine')}
                    title={t('setupOnboarding.webDesktopOnlyTitle')}
                    subtitle={t('setupOnboarding.webDesktopOnlyBody')}
                />
            ) : null}
        </ItemList>
    );
});
