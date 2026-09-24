import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { BrandLogo } from '@/components/ui/navigation/BrandLogo';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

export type BrandWordmarkProps = Readonly<{
    /** 原图的显示边长；文字沿用应用字体缩放。默认 32。 */
    height?: number;
    testID?: string;
}>;

/** 欢迎流程共用原 Logo 与产品名，避免不同入口出现两套品牌。 */
export const BrandWordmark = React.memo(function BrandWordmark(props: BrandWordmarkProps) {
    const { theme } = useUnistyles();
    const height = props.height ?? 32;
    return (
        <View
            testID={props.testID ?? 'brand-wordmark'}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' }}
        >
            <BrandLogo size={height} />
            <Text style={{ fontSize: Math.round(height * 0.75), color: theme.colors.text.primary, flexShrink: 1, ...Typography.default('semiBold') }}>
                {t('common.appName')}
            </Text>
        </View>
    );
});
