import * as React from 'react';
import { View, Platform } from 'react-native';
import { useDeviceType } from '@/utils/platform/responsive';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { SegmentedTabBar, type SegmentedTab } from '@/components/ui/navigation/SegmentedTabBar';
import { t } from '@/text';
import type { SessionStorageKind } from '@/sync/domains/session/sessionStorageKind';

export type SessionListStorageTabsBarProps = Readonly<{
    activeTabId: SessionStorageKind;
    onSelectTab: (tabId: SessionStorageKind) => void;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 15,
        paddingTop: 10,
        paddingBottom: 10,
        backgroundColor: theme.colors.background.canvas,
    },
    phoneContainer: {
        paddingHorizontal: 16,
        paddingTop: 0,
        paddingBottom: 0,
    },
}));

const tabs: ReadonlyArray<SegmentedTab<SessionStorageKind>> = [
    { id: 'persisted', label: t('sessionsList.storagePersistedTab') },
    { id: 'direct', label: t('sessionsList.storageDirectTab') },
];

/** 手机使用轻量下划线来源切换，既有来源选择及列表缓存不变。 */
export const SessionListStorageTabsBar = React.memo((props: SessionListStorageTabsBarProps) => {
    const styles = stylesheet;
    useUnistyles();
    const deviceType = useDeviceType();
    const isPhone = Platform.OS !== 'web' && deviceType === 'phone';

    return (
        <View style={[styles.container, isPhone ? styles.phoneContainer : null]}>
            <SegmentedTabBar
                appearance={isPhone ? 'underline' : 'segmented'}
                tabs={tabs}
                activeTabId={props.activeTabId}
                onSelectTab={props.onSelectTab}
                testIDPrefix="sessions-list-storage-tab"
            />
        </View>
    );
});
