import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SelectionListSectionHeader } from '@/components/ui/selectionList';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';

export const InboxSection = React.memo(function InboxSection(props: Readonly<{
    id: string;
    title: string;
    children: React.ReactNode;
    headerAction?: React.ReactNode;
    spacing?: 'following' | 'separated';
    surface?: 'flat' | 'grouped';
}>) {
    const grouped = props.surface === 'grouped';
    const header = (
        <SelectionListSectionHeader
            testID={`inbox.section.${props.id}.header`}
            title={props.title}
            rightAccessory={props.headerAction}
            containerStyle={grouped
                ? styles.groupedHeader
                : props.headerAction
                    ? styles.actionHeader
                    : undefined}
        />
    );

    return (
        <View
            testID={`inbox.section.${props.id}`}
            style={[
                styles.section,
                props.spacing === 'following' ? styles.sectionFollowing : null,
                props.spacing === 'separated' ? styles.sectionSeparated : null,
            ]}
        >
            {grouped ? (
                <ItemGroup title={header} headerStyle={styles.groupedItemGroupHeader} clipContent>
                    {props.children}
                </ItemGroup>
            ) : (
                <>
                    {header}
                    {props.children}
                </>
            )}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    section: {
        width: '100%',
    },
    sectionFollowing: {
        marginTop: 6,
    },
    sectionSeparated: {
        marginTop: 14,
    },
    groupedHeader: {
        minHeight: Platform.select({ ios: 44, default: 48 }),
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        paddingTop: 0,
        paddingBottom: 0,
    },
    actionHeader: {
        minHeight: Platform.select({ ios: 44, default: 48 }),
    },
    groupedItemGroupHeader: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
}));
