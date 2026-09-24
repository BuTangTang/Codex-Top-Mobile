import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type KeyboardControllerMockProps = React.PropsWithChildren<Record<string, unknown>>;

let controllerValue: any = null;
const layout = vi.hoisted(() => ({ type: 'desktop' }));
vi.mock('@/utils/platform/responsive', () => ({ useDeviceType: () => layout.type }));

installSettingsViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            KeyboardAvoidingView: ({ children }: any) => React.createElement('KeyboardAvoidingView', null, children),
            Platform: {
                OS: 'ios',
                select: ({ ios, default: defaultValue }: any) => ios ?? defaultValue,
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock().module;
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {},
        });
    },
});

vi.mock('react-native-keyboard-controller', () => ({
    KeyboardAwareScrollView: ({ children, ...props }: KeyboardControllerMockProps) =>
        React.createElement('KeyboardAwareScrollView', props, children),
    KeyboardAvoidingView: ({ children, ...props }: KeyboardControllerMockProps) =>
        React.createElement('KeyboardAvoidingView', props, children),
    KeyboardStickyView: ({ children, ...props }: KeyboardControllerMockProps) =>
        React.createElement('KeyboardStickyView', props, children),
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children, ...props }: any) => React.createElement('ItemList', props, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, title }: any) => React.createElement('ItemGroup', { title }, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

vi.mock('@/components/settings/server/sections/SavedServersSection', () => ({
    SavedServersSection: (props: any) => React.createElement('SavedServersSection', props),
}));

vi.mock('@/components/settings/server/sections/ServerRetentionSection', () => ({
    ServerRetentionSection: (props: any) => React.createElement('ServerRetentionSection', props),
}));

vi.mock('@/components/settings/server/sections/AddTargetsSection', () => ({
    AddTargetsSection: (props: any) => React.createElement('AddTargetsSection', props),
}));

vi.mock('@/components/settings/server/sections/ServerGroupsSection', () => ({
    ServerGroupsSection: (props: any) => React.createElement('ServerGroupsSection', props),
}));

vi.mock('@/components/settings/server/RelayDriftActionCard', () => ({
    RelayDriftActionCard: (props: any) => React.createElement('RelayDriftActionCard', props),
}));

vi.mock('@/components/settings/server/localControl/LocalRelayRuntimeControlSection', () => ({
    LocalRelayRuntimeControlSection: (props: any) => React.createElement('LocalRelayRuntimeControlSection', props),
}));

vi.mock('@/components/settings/server/localControl/LocalTailscaleSecureAccessSection', () => ({
    LocalTailscaleSecureAccessSection: (props: any) => React.createElement('LocalTailscaleSecureAccessSection', props),
}));

vi.mock('@/components/settings/server/hooks/useServerSettingsScreenController', () => ({
    useServerSettingsScreenController: () => controllerValue,
}));

function setController(overrides: Partial<any>) {
    controllerValue = {
        screenOptions: { headerShown: true, headerTitle: 'Relay settings', headerBackTitle: 'Back' },
        servers: [],
        serverGroups: [],
        activeServerId: 'server-a',
        activeServerUrl: '',
        activeLocalRelayUrl: null,
        deviceDefaultServerId: 'server-a',
        activeTargetKey: null,
        authStatusByServerId: {},
        relayDriftBanner: null,

        autoMode: false,
        inputUrl: '',
        inputName: '',
        error: null,
        isValidating: false,
        onChangeUrl: vi.fn(),
        onChangeName: vi.fn(),
        onResetServer: vi.fn(),
        onAddServer: vi.fn(),

        onSwitchServer: vi.fn(),
        onSwitchGroup: vi.fn(),
        onRenameServer: vi.fn(),
        onRemoveServer: vi.fn(),
        onRenameGroup: vi.fn(),
        onRemoveGroup: vi.fn(),
        onCreateServerGroup: vi.fn(async () => false),

        groupSelectionEnabled: false,
        setGroupSelectionEnabled: vi.fn(),
        groupSelectionPresentation: 'grouped',
        activeServerGroupId: null,
        selectedGroupServerIds: new Set<string>(),
        onToggleGroupPresentation: vi.fn(),
        onToggleGroupServer: vi.fn(),

        ...overrides,
    };
}

describe('ServerSettingsScreen (concurrent section visibility)', () => {
    it('hides concurrent multi-relay settings when there are no relay groups', async () => {
        setController({ serverGroups: [] });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findAllByType('ServerGroupsSection' as any)).toHaveLength(0);
    });

    it('shows concurrent multi-relay settings when there is at least one relay group', async () => {
        setController({
            serverGroups: [{ id: 'grp-one', name: 'Group One', serverIds: ['server-a'], presentation: 'grouped' }],
        });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findAllByType('ServerGroupsSection' as any)).toHaveLength(1);
    });

    it('omits relay drift repair prompts from the Relay settings screen', async () => {
        setController({
            relayDriftBanner: {
                kind: 'warning',
                title: 'relay.banner.title',
                description: 'relay.banner.description',
                actionLabel: 'relay.banner.action',
            },
        });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        const banners = screen.findAllByType('RelayDriftActionCard' as any);
        expect(banners).toHaveLength(0);

        const notice = screen.findByTestId('settings.server.relayDrift.readOnlyNotice');
        expect(notice).toBeNull();
    });

    it('omits local relay runtime and secure access controls from the Relay settings screen', async () => {
        setController({ relayDriftBanner: null });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findAllByType('LocalRelayRuntimeControlSection' as any)).toHaveLength(0);
        expect(screen.findAllByType('LocalTailscaleSecureAccessSection' as any)).toHaveLength(0);
        expect(screen.findByTestId('settings.server.localControl.desktopOnlyNotice')).toBeNull();
    });

    it('omits secure-access local control even when a known local relay alias exists', async () => {
        setController({
            activeServerUrl: 'https://relay.example.test',
            activeLocalRelayUrl: 'http://127.0.0.1:4555',
            relayDriftBanner: null,
        });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findAllByType('LocalTailscaleSecureAccessSection' as any)).toHaveLength(0);
        expect(screen.findByTestId('settings.server.localControl.desktopOnlyNotice')).toBeNull();
    });

    it('keeps relay form actions tappable while the keyboard is open', async () => {
        setController({ relayDriftBanner: null });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');
        const { KeyboardAwareScrollView } = await import('@/components/ui/keyboardAvoidance');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));
        const keyboardAwareList = screen.findByType(KeyboardAwareScrollView);

        expect(keyboardAwareList.props.ScrollViewComponent).toBeTruthy();
        expect(keyboardAwareList.props.keyboardShouldPersistTaps).toBe('handled');
        expect(keyboardAwareList.props.keyboardDismissMode).toBe('interactive');
        expect(keyboardAwareList.props.automaticallyAdjustKeyboardInsets).toBe(true);
    });
    it('hides Android phone expert groups but preserves address action', async () => {
        const { Platform } = await import('react-native');
        const previous = Platform.OS;
        layout.type = 'phone';
        (Platform as any).OS = 'android';
        try {
            setController({ servers: [{ id: 'server-a', serverUrl: 'https://one.test', name: 'Current' }, { id: 'server-b', serverUrl: 'https://two.test', name: 'Other' }], serverGroups: [{ id: 'group', serverIds: ['server-a'] }] });
            const { ServerSettingsScreen } = await import('./ServerSettingsScreen');
            const screen = await renderScreen(React.createElement(ServerSettingsScreen));
            expect(screen.findAllByType('ServerRetentionSection' as any)).toHaveLength(0);
            expect(screen.findAllByType('ServerGroupsSection' as any)).toHaveLength(0);
            const saved = screen.findByType('SavedServersSection' as any);
            expect(saved.props.servers.map((server: any) => server.id)).toEqual(['server-a']);
            expect(saved.props.serverGroups).toEqual([]);
            expect(saved.props.compact).toBe(true);
            const add = screen.findByType('AddTargetsSection' as any);
            expect(add.props.compact).toBe(true);
            await add.props.onAddServer();
            expect(controllerValue.onAddServer).toHaveBeenCalledOnce();
        } finally { layout.type = 'desktop'; (Platform as any).OS = previous; }
    });

});
