import * as React from 'react';
import type { ScrollView, ScrollViewProps } from 'react-native';
import { Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useDeviceType } from '@/utils/platform/responsive';
import { resolveServerProfileScopeId } from '@/sync/domains/server/serverProfiles';

import { ItemList } from '@/components/ui/lists/ItemList';
import { KeyboardAwareScrollView } from '@/components/ui/keyboardAvoidance';
import { SavedServersSection } from '@/components/settings/server/sections/SavedServersSection';
import { AddTargetsSection } from '@/components/settings/server/sections/AddTargetsSection';
import { ServerGroupsSection } from '@/components/settings/server/sections/ServerGroupsSection';
import { ServerRetentionSection } from '@/components/settings/server/sections/ServerRetentionSection';
import { useServerSettingsScreenController } from '@/components/settings/server/hooks/useServerSettingsScreenController';

const stylesheet = StyleSheet.create((_theme) => ({
    itemListContainer: {
        flex: 1,
    },
}));

type KeyboardAwareItemListProps = ScrollViewProps & Readonly<{
    children?: React.ReactNode;
}>;

const ServerSettingsKeyboardAwareItemList = React.forwardRef<ScrollView, KeyboardAwareItemListProps>(
    function ServerSettingsKeyboardAwareItemList({ children, ...props }, ref) {
        return (
            <ItemList ref={ref} {...props}>
                {children}
            </ItemList>
        );
    },
);

/** 手机只展示当前连接与地址入口，仍复用原控制器的验证和切服。 */
export function ServerSettingsScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const controller = useServerSettingsScreenController();
    const deviceType = useDeviceType();
    const compact = Platform.OS === 'android' && deviceType === 'phone';
    const visibleServers = compact ? controller.servers.filter((server) => server.id === controller.activeServerId || resolveServerProfileScopeId(server) === controller.activeServerId) : controller.servers;

    return (
        <KeyboardAwareScrollView
            style={[styles.itemListContainer, compact ? { backgroundColor: theme.colors.surface.base } : undefined]}
            ScrollViewComponent={ServerSettingsKeyboardAwareItemList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            {...(Platform.OS === 'ios' ? { automaticallyAdjustKeyboardInsets: true } : {})}
        >
            <SavedServersSection
                compact={compact}
                servers={visibleServers}
                serverGroups={compact ? [] : controller.serverGroups}
                activeServerId={controller.activeServerId}
                deviceDefaultServerId={controller.deviceDefaultServerId}
                activeTargetKey={controller.activeTargetKey}
                authStatusByServerId={controller.authStatusByServerId}
                onSwitch={controller.onSwitchServer}
                onSwitchGroup={controller.onSwitchGroup}
                onRenameGroup={controller.onRenameGroup}
                onRemoveGroup={controller.onRemoveGroup}
                onRename={controller.onRenameServer}
                onRemove={controller.onRemoveServer}
            />

            {!compact ? <ServerRetentionSection serverId={controller.activeServerId || null} /> : null}

            <AddTargetsSection
                compact={compact}
                autoMode={controller.autoMode}
                inputUrl={controller.inputUrl}
                inputName={controller.inputName}
                error={controller.error}
                isValidating={controller.isValidating}
                prefillHint={controller.addServerPrefillHint}
                defaultExpanded={controller.addServerDefaultExpanded}
                onChangeUrl={controller.onChangeUrl}
                onChangeName={controller.onChangeName}
                onResetServer={controller.onResetServer}
                onAddServer={controller.onAddServer}
                servers={controller.servers}
                activeServerId={controller.activeServerId}
                onCreateServerGroup={controller.onCreateServerGroup}
            />

            {!compact && controller.serverGroups.length > 0 ? (
                <ServerGroupsSection
                    groupSelectionEnabled={controller.groupSelectionEnabled}
                    setGroupSelectionEnabled={controller.setGroupSelectionEnabled}
                    groupSelectionPresentation={controller.groupSelectionPresentation}
                    activeServerGroupId={controller.activeServerGroupId}
                    selectedGroupServerIds={controller.selectedGroupServerIds}
                    servers={controller.servers}
                    onToggleGroupPresentation={controller.onToggleGroupPresentation}
                    onToggleGroupServer={controller.onToggleGroupServer}
                />
            ) : null}
        </KeyboardAwareScrollView>
    );
}
