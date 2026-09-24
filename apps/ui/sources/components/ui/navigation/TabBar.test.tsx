import * as React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { installNavigationCommonModuleMocks } from './navigationTestHelpers';
import { renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installNavigationCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({ View: 'View', Pressable: 'Pressable' });
    },
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-image', () => ({
    Image: 'Image',
}));

vi.mock('expo-blur', () => ({
    BlurView: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('BlurView', props, children),
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 960 },
}));

describe('TabBar', () => {
    it('shows only sessions, computers and account with labels and selection semantics', async () => {
        const { TabBar } = await import('./TabBar');
        const onTabPress = vi.fn();
        const screen = await renderScreen(<TabBar activeTab="machines" onTabPress={onTabPress} />);
        const tabs = screen.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'tab');
        expect(tabs.map((node) => node.props.testID)).toEqual([
            'tabbar-tab-sessions', 'tabbar-tab-machines', 'tabbar-tab-settings',
        ]);
        expect(tabs.map((node) => node.props.accessibilityLabel)).toEqual(['tabs.sessions', 'tabs.machines', 'tabs.account']);
        expect(tabs[1].props.accessibilityState.selected).toBe(true);
        renderer.act(() => tabs[1].props.onPress());
        expect(onTabPress).toHaveBeenCalledWith('machines');
    });

    it('keeps the new conversation action separate from the three tabs', async () => {
        const { TabBar } = await import('./TabBar');
        const screen = await renderScreen(<TabBar activeTab="sessions" onTabPress={() => {}}
            trailingAccessory={React.createElement('TrailingAccessory')} />);
        expect(screen.tree.findAllByType('TrailingAccessory' as never)).toHaveLength(1);
        expect(screen.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'tab')).toHaveLength(3);
    });
});
