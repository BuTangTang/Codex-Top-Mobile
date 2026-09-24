import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { ITEM_SUBTITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';

/** 将会话读取或连接说明呈现为可换行的轻量提示，不建立独立业务状态。 */
export function ConversationNotice(props: Readonly<{ testID: string; body: string }>) {
    const { theme } = useUnistyles();
    return (
        <View testID={props.testID} style={styles.row}>
            <Icon name="info" size={16} color={theme.colors.text.secondary} />
            <Text style={styles.text} accessibilityLiveRegion="polite">{props.body}</Text>
        </View>
    );
}

/** 使用主题次级文字色与自适应高度，深色及大字体保持可读。 */
const styles = StyleSheet.create((theme) => ({
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 4 },
    text: { ...ITEM_SUBTITLE_TEXT_METRICS.compact, color: theme.colors.text.secondary, flex: 1 },
}));
