import * as React from 'react';
import { Platform } from 'react-native';
import { useDeviceType } from '@/utils/platform/responsive';
import { CenteredInfoTile } from '@/components/ui/lists/CenteredInfoTile';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { useUnistyles } from 'react-native-unistyles';

import { ActiveSelectionMachinesSection } from '@/components/settings/server/sections/ActiveSelectionMachinesSection';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { t } from '@/text';

import type { useMachinesSettingsViewModel } from './machinesSettingsViewModel';
import { Icon } from '@/components/ui/icons/Icon';

type MachinesSettingsViewModel = ReturnType<typeof useMachinesSettingsViewModel>;

type MachinesListSectionProps = Readonly<{
    viewModel: MachinesSettingsViewModel;
    onOpenMachine: (machineId: string, serverId?: string) => void;
}>;

/** 手机复用真实机器分组并保持紧凑行，桌面沿用原列表。 */
export const MachinesListSection = React.memo(function MachinesListSection(props: MachinesListSectionProps) {
    const { theme } = useUnistyles();
    const deviceType = useDeviceType();
    const isPhone = Platform.OS !== 'web' && deviceType === 'phone';

    // 手机使用真实机器分组和在线状态；不把安装命令、运行器标记放进电脑卡片。
    if (isPhone) {
        if (!props.viewModel.hasMachines) {
            return <CenteredInfoTile
                testID="phone-machines-empty"
                title={props.viewModel.isLoadingMachines ? t('common.loading') : t('sessionGettingStarted.phoneTitle')}
                description={props.viewModel.isLoadingMachines ? '' : t('sessionGettingStarted.phoneSubtitle')}
                icon={<Icon name="desktop" size={32} color={theme.colors.text.secondary} />}
            />;
        }
        const groups = props.viewModel.showMachinesGroupedByServer
            ? props.viewModel.visibleMachineGroups
            : [{ serverId: props.viewModel.activeServerId, serverName: '', machines: props.viewModel.allMachines }];
        return <>{groups.map((group) => <SettingsSection compact key={group.serverId}>
            {group.machines.map((machine) =>
                <Item
                    key={machine.id}
                    testID={`phone-machine-${group.serverId}-${machine.id}`}
                    density="cozy"
                    titleLines={0}
                    title={machine.metadata?.displayName || machine.metadata?.host || machine.id}
                    subtitle={isMachineOnline(machine) ? t('status.online') : t('status.offline')}
                    icon={<Icon name="desktop" size={24} color={theme.colors.accent.blue} />}
                    onPress={() => props.onOpenMachine(machine.id, group.serverId)}
                />
            )}
        </SettingsSection>)}</>;
    }


    if (!props.viewModel.hasMachines) {
        const title = props.viewModel.isLoadingMachines ? t('common.loading') : t('newSession.noMachinesFound');
        return (
            <ItemGroup title={t('settings.machines')}>
                <Item
                    title={title}
                    icon={<Icon name="desktop" size={29} color={theme.colors.text.secondary} />}
                    showChevron={false}
                />
            </ItemGroup>
        );
    }

    return (
        <ActiveSelectionMachinesSection
            hasAnyVisibleMachines={props.viewModel.hasMachines}
            showMachinesGroupedByServer={props.viewModel.showMachinesGroupedByServer}
            visibleMachineGroups={props.viewModel.visibleMachineGroups}
            allMachines={props.viewModel.allMachines}
            activeServerId={props.viewModel.activeServerId}
            machinesTitle={t('settings.machines')}
            themeColors={{
                textSecondary: theme.colors.text.secondary,
                status: {
                    connected: theme.colors.status.connected,
                    disconnected: theme.colors.status.disconnected,
                },
            }}
            onOpenMachine={props.onOpenMachine}
        />
    );
});
