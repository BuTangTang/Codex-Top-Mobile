import * as React from 'react';
import { View } from 'react-native';
import { BrandLogo } from './BrandLogo';

/**
 * 各主标签复用同一原图，保持现有头部占位和切换稳定性。
 * Extracted to prevent flickering on tab switches - when each tab
 * had its own HeaderLeft, the component would unmount/remount.
 */
export const HeaderLogo = React.memo(() => {
    return (
        <View style={{
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
        }}>
            <BrandLogo size={24} />
        </View>
    );
});
