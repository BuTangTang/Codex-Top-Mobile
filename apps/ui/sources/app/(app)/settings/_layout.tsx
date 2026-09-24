import * as React from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { createAppStackScreenOptions } from '@/components/navigation/createAppStackScreenOptions';
import { getSettingsStackScreenDefinitions } from '@/components/settings/navigation/settingsRouteRegistry';
import { t } from '@/text';
import { isTauriDesktop } from '@/utils/platform/tauri';
import { useDeviceType } from '@/utils/platform/responsive';
import { isRunningOnMac } from '@/utils/platform/platform';

/** 仅手机个人主入口采用无返回标题，详情页保持现有导航配置。 */
export default function SettingsLayout() {
    const { theme } = useUnistyles();
    const deviceType = useDeviceType();
    const phoneMainTab = deviceType === 'phone' && !isRunningOnMac() && !isTauriDesktop();
    const shouldUseCustomHeader = Platform.OS === 'android' || isRunningOnMac() || Platform.OS === 'web';
    const screenOptions = React.useMemo(() => createAppStackScreenOptions({
        headerBackTitle: t('common.back'),
        shouldUseCustomHeader,
        theme,
    }), [shouldUseCustomHeader, theme]);
    const screenDefinitions = React.useMemo(() => getSettingsStackScreenDefinitions(t, { phoneMainTab }), [phoneMainTab]);

    return (
        <Stack screenOptions={screenOptions}>
            {screenDefinitions.map((definition) => (
                <Stack.Screen
                    key={definition.name}
                    name={definition.name}
                    options={definition.options}
                />
            ))}
        </Stack>
    );
}
