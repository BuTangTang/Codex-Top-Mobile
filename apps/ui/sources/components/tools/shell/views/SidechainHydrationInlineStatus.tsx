import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import type { SidechainHydrationStatus } from '@/hooks/session/useEnsureSidechainsLoaded';

export function shouldShowSidechainHydrationInlineStatus(params: Readonly<{
    messageCount: number;
    sidechainId: string | null;
    status: SidechainHydrationStatus;
}>): boolean {
    if (!params.sidechainId) return false;
    if (params.messageCount > 0) return false;
    return params.status !== 'idle' && params.status !== 'loaded';
}

export function SidechainHydrationInlineStatus(props: Readonly<{
    status: SidechainHydrationStatus;
    testID: string;
}>): React.ReactElement | null {
    const { theme } = useUnistyles();
    const isUnavailable = props.status === 'error' || props.status === 'not_ready';
    return (
        <View testID={props.testID} style={styles.container}>
            {isUnavailable ? null : <ActivitySpinner size="small" color={theme.colors.text.secondary} />}
            <Text style={styles.text}>
                {isUnavailable ? t('common.unavailable') : t('common.loading')}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        minHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 4,
    },
    text: {
        color: theme.colors.text.secondary,
    },
}));
