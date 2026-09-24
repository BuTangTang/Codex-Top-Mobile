import * as React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { Text } from '@/components/ui/text/Text';
import { ITEM_SUBTITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { resolveTabBarMetrics } from '@/components/ui/navigation/tabBarMetrics';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { resolveTabBarTabs } from './resolveTabBarTabs';
import type { TabType } from './tabTypes';

export type { TabType };

interface TabBarProps {
    activeTab: TabType;
    onTabPress: (tab: TabType) => void;
    /** 新会话操作保持独立按钮，不成为第四个导航目的地。 */
    trailingAccessory?: React.ReactNode;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        alignSelf: 'stretch',
        backgroundColor: theme.colors.surface.base,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.default,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    tabs: { flex: 1, flexDirection: 'row' },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
    label: { textAlign: 'center', ...ITEM_SUBTITLE_TEXT_METRICS.tight, ...Typography.default() },
    // 行高来自三个导航项，方形容器给独立新建按钮提供确定的宽高。
    accessory: { alignSelf: 'stretch', aspectRatio: 1, justifyContent: 'center' },
}));

/** 正式三入口使用紧凑布局及共用按压/键盘反馈，保留安全区与大字自适应高度。 */
export const TabBar = React.memo(function TabBar({ activeTab, onTabPress, trailingAccessory }: TabBarProps) {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const metrics = resolveTabBarMetrics('compact', true);
    return (
        <View style={[styles.container, { paddingBottom: insets.bottom }]}>
            <View style={styles.row}>
                <View style={styles.tabs}>
                    {resolveTabBarTabs().map((key) => {
                        const selected = key === activeTab;
                        const label = key === 'machines' ? t('tabs.machines') : key === 'settings' ? t('tabs.account') : t('tabs.sessions');
                        const name: IconName = key === 'machines' ? 'laptop' : key === 'settings' ? 'user-circle' : 'chats-circle';
                        const color = selected ? theme.colors.accent.blue : theme.colors.text.secondary;
                        return (
                            <PressableSurface key={key} testID={`tabbar-tab-${key}`} accessibilityRole="tab"
                                accessibilityLabel={label} accessibilityState={{ selected }}
                                style={[styles.tab, { minHeight: 48, minWidth: metrics.tabMinWidth, paddingVertical: metrics.tabPaddingVertical }]}
                                onPress={() => onTabPress(key)}>
                                <Icon name={name} size={metrics.iconSize} color={color} />
                                <Text style={[styles.label, { color }]}>{label}</Text>
                            </PressableSurface>
                        );
                    })}
                </View>
                {trailingAccessory ? <View style={styles.accessory}>{trailingAccessory}</View> : null}
            </View>
        </View>
    );
});
