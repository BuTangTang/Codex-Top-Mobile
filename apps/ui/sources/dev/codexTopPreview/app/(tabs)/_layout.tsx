import { Tabs } from 'expo-router';

import { CodexTopPreviewTabBar } from '../../ui/CodexTopPreviewTabBar';

/**
 * 底栏路由。把 Expo Router 的标签状态交给样板底栏，不使用正式壳层。
 */
export default function CodexTopPreviewTabsLayout() {
    return (
        <Tabs
            screenOptions={{ headerShown: false }}
            tabBar={(props) => (
                <CodexTopPreviewTabBar
                    index={props.state.index}
                    routes={props.state.routes}
                    onNavigate={(name) => props.navigation.navigate(name)}
                />
            )}
        >
            <Tabs.Screen name="index" options={{ title: '会话' }} />
            <Tabs.Screen name="computer" options={{ title: '电脑' }} />
            <Tabs.Screen name="me" options={{ title: '我的' }} />
        </Tabs>
    );
}
