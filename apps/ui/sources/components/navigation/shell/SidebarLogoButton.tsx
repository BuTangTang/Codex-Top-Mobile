import * as React from 'react';
import { Pressable, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { BrandLogo } from '@/components/ui/navigation/BrandLogo';

import { t } from '@/text';

const SIDEBAR_LOGO_IMAGE_STYLE: ImageStyle = {
    height: 24,
    width: 24,
};

type SidebarLogoButtonProps = Readonly<{
    onPress: () => void;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}>;

/** 保留侧栏回首页操作与尺寸，仅统一原图品牌。 */
export const SidebarLogoButton = React.memo((props: SidebarLogoButtonProps) => {
    return (
        <Pressable
            testID={props.testID}
            onPress={props.onPress}
            hitSlop={15}
            accessibilityRole="button"
            accessibilityLabel={t('common.home')}
            style={props.style}
        >
            <BrandLogo
                style={[SIDEBAR_LOGO_IMAGE_STYLE]}
            />
        </Pressable>
    );
});
