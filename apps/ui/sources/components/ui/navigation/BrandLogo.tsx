import * as React from 'react';
import { Image, type ImageProps } from 'expo-image';

type BrandLogoProps = Readonly<{
    size?: number;
    style?: ImageProps['style'];
    testID?: string;
}>;

/** 复用用户的蓝 C 橙点原图；深浅主题均保留原色和原始比例。 */
export const BrandLogo = React.memo(function BrandLogo({ size = 24, style, testID }: BrandLogoProps) {
    return (
        <Image
            testID={testID}
            source={require('@/assets/images/codex-top.png')}
            contentFit="contain"
            accessible={false}
            style={[{ width: size, height: size }, style]}
        />
    );
});
