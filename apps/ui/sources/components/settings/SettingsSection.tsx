import * as React from 'react';
import { Platform, StyleSheet as NativeStyleSheet, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ItemGroup, type ItemGroupProps } from '@/components/ui/lists/ItemGroup';
import { ITEM_GROUP_CONTAINER_HORIZONTAL_PADDING_PX } from '@/components/ui/lists/itemGroupSpacing';
import { flattenItemGroupElementChildren } from '@/components/ui/lists/ItemGroup.dividers';

/** 紧凑设置只覆盖装饰层；颜色与线宽仍取主题和平台规范。 */
const styles = StyleSheet.create((theme) => ({
    flatSurface: {
        marginHorizontal: -(Platform.select(ITEM_GROUP_CONTAINER_HORIZONTAL_PADDING_PX) ?? 0),
        borderRadius: 0,
        borderWidth: 0,
        borderTopWidth: NativeStyleSheet.hairlineWidth,
        borderBottomWidth: NativeStyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
        boxShadow: 'none',
    },
    header: { paddingTop: 12, paddingBottom: 6, paddingHorizontal: 16 },
    emptyHeader: { padding: 0, paddingTop: 0, paddingBottom: 0 },
    footer: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
    divider: { height: NativeStyleSheet.hairlineWidth, backgroundColor: theme.colors.border.default, marginHorizontal: 16 },
}));

/** 手机去掉设置卡片装饰与无标题留白，选择、分隔线和无障碍继续由原列表组件处理。 */
export function SettingsSection({ compact = false, ...props }: ItemGroupProps & Readonly<{ compact?: boolean }>) {
    // 原 Item 在 Android / Web 不画分隔线；仅补显示线，保留原节点、按压与选择 owner。
    const children = compact && Platform.OS !== 'ios'
        ? flattenItemGroupElementChildren(props.children).flatMap((row, index) => index === 0 ? [row] : [
            <View key={`separator-${row.key ?? index}`} pointerEvents="none" style={styles.divider} />,
            row,
        ])
        : props.children;
    // 空 Fragment 让原组件走可覆盖的标题槽，避开它固定的无标题 16px 间距。
    return (
        <ItemGroup
            {...props}
            children={children}
            title={compact ? props.title ?? <></> : props.title}
            headerStyle={compact ? [props.title ? styles.header : styles.emptyHeader, props.headerStyle] : props.headerStyle}
            containerStyle={compact ? [styles.flatSurface, props.containerStyle] : props.containerStyle}
            footerStyle={compact ? [styles.footer, props.footerStyle] : props.footerStyle}
        />
    );
}
