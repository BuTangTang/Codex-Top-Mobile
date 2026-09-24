import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import type { SessionListStatusFilter } from '@/sync/domains/session/listing/filterSessionListViewDataByStatus';
import * as React from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { SessionStorageKind } from '@/sync/domains/session/sessionStorageKind';
import { t } from '@/text';
import { SessionListStorageTabsBar } from './SessionListStorageTabsBar';
import { Icon } from '@/components/ui/icons/Icon';

const stylesheet = StyleSheet.create(() => ({
    browseActionContainer: {
        marginTop: -4,
    },
    browseActionGroupSurface: {
        backgroundColor: 'transparent',
        boxShadow: 'none',
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
}));

export type SessionsListStorageChromeProps = Readonly<{
    statusFilter?: SessionListStatusFilter;
    onSelectStatusFilter?: (filter: SessionListStatusFilter) => void;
    directSessionsEnabled: boolean;
    storageKind: SessionStorageKind | 'all';
    onSelectStorageKind: (storageKind: SessionStorageKind) => void;
}>;

/** 手机只展示统一列表的状态筛选；桌面沿用来源标签。 */
export const SessionsListStorageChrome = React.memo((props: SessionsListStorageChromeProps) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const showDirectBrowseAction = props.directSessionsEnabled && (props.storageKind === 'direct' || props.storageKind === 'all');

    return (
        <>
            {props.directSessionsEnabled && !props.statusFilter && props.storageKind !== 'all' ? (
                <SessionListStorageTabsBar
                    activeTabId={props.storageKind}
                    onSelectTab={props.onSelectStorageKind}
                />
            ) : null}
            {props.statusFilter && props.onSelectStatusFilter ? <SegmentedTabBar
                appearance="underline"
                tabs={[
                    { id: 'all' as const, label: t('common.all') },
                    { id: 'working' as const, label: t('inbox.actionOperations.sections.inProgress') },
                    { id: 'attention' as const, label: t('sessionsList.statusAwaitingConfirmation') },
                ]}
                activeTabId={props.statusFilter}
                onSelectTab={props.onSelectStatusFilter}
                testIDPrefix="sessions-list-status-tab"
            /> : null}
            {showDirectBrowseAction ? (
                <ItemGroup
                    style={styles.browseActionContainer}
                    containerStyle={styles.browseActionGroupSurface}
                    constrainToContentWidth={false}
                >
                    <Item
                        testID="direct-sessions-browse-button"
                        title={t('directSessions.browseOpenExisting')}
                        subtitle={props.statusFilter ? undefined : t('directSessions.browseActionSubtitle')}
                        density={props.statusFilter ? 'cozy' : undefined}
                        icon={<Icon name="folder-open" size={20} color={theme.colors.text.secondary} />}
                        onPress={() => {
                            router.push('/direct/browse');
                        }}
                    />
                </ItemGroup>
            ) : null}
        </>
    );
});
