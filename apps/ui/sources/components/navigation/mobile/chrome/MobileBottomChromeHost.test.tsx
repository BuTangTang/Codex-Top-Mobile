import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { findGestureByKind, type TestGestureChain } from '@/dev/testkit/mocks/gestureHandler';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { buildSessionNavigationCursor } from '@/sync/domains/session/navigation/sessionNavigationCursor';
import {
    publishSessionNavigationCursor,
    resetSessionNavigationCursorForTests,
} from '@/sync/domains/session/navigation/sessionNavigationCursorStore';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const pathState = vi.hoisted(() => ({
    pathname: '/',
}));
const reanimatedSpringState = vi.hoisted(() => ({
    targets: [] as unknown[],
}));
const pathListeners = vi.hoisted(() => ({
    listeners: new Set<() => void>(),
}));
const searchParamsState = vi.hoisted(() => ({
    id: undefined as string | string[] | undefined,
    mobileSurface: undefined as string | string[] | undefined,
    serverId: undefined as string | string[] | undefined,
    sourceSurface: undefined as string | string[] | undefined,
    machineId: undefined as string | undefined,
    projectId: undefined as string | undefined,
    sourceKey: undefined as string | undefined,
}));
const authState = vi.hoisted(() => ({
    isAuthenticated: true,
}));
const tabState = vi.hoisted(() => ({
    setActiveTab: vi.fn(async () => {}),
}));
const tabBarRenderState = vi.hoisted(() => ({
    renderSpy: vi.fn(),
}));
const settingsState = vi.hoisted(() => ({
    mobileWorkspaceExperienceV1: undefined as 'classic' | 'cockpit' | undefined,
    sessionCockpitSwipeNavigationEnabled: true as boolean,
    sessionLastMobileSurfaceBySessionId: null as Record<string, string> | null,
    embeddedTerminalDockLocation: 'sidebar' as string | null,
}));
const storageListeners = vi.hoisted(() => ({
    listeners: new Set<() => void>(),
}));
const deviceTypeState = vi.hoisted(() => ({
    value: 'phone' as 'phone' | 'tablet' | 'desktop',
}));
const featureState = vi.hoisted(() => ({
    terminalEmbeddedPtyEnabled: true,
    terminalEmbeddedPtyServerId: null as string | null,
    resolvedServerId: 'server-session' as string | null,
}));
const storageMutators = vi.hoisted(() => ({
    setMobileWorkspaceExperience: vi.fn(),
    setSessionLastMobileSurfaceBySessionId: vi.fn(),
}));
const routerState = vi.hoisted(() => ({
    back: vi.fn(),
    navigate: vi.fn(),
    replace: vi.fn(),
    setParams: vi.fn(),
}));
const navigationState = vi.hoisted(() => ({
    canGoBack: null as boolean | null,
    goBack: vi.fn(),
}));
const animatedTimingState = vi.hoisted(() => ({
    timings: [] as Array<{
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        toValue: number;
        finish: (finished?: boolean) => void;
    }>,
}));
const keyboardHeightState = vi.hoisted(() => ({
    value: 0,
}));
const gestureHandlerState = vi.hoisted(() => ({
    gestures: [] as TestGestureChain[],
}));
const platformState = vi.hoisted(() => ({
    // The bottom-chrome band is a native-phone surface, and the lateral swipe only
    // exists there, so this suite runs as a native phone by default.
    os: 'ios' as 'ios' | 'android' | 'web',
}));
const sessionMetadataState = vi.hoisted(() => ({
    bySessionId: {} as Record<string, { name?: string } | null>,
}));
const hapticsState = vi.hoisted(() => ({
    impacts: [] as string[],
    selections: 0,
}));
const reducedMotionState = vi.hoisted(() => ({
    value: false,
}));

const expoRouterMock = createExpoRouterMock({
    pathname: () => pathState.pathname,
    params: () => ({
        id: searchParamsState.id,
        mobileSurface: searchParamsState.mobileSurface,
        serverId: searchParamsState.serverId,
        sourceSurface: searchParamsState.sourceSurface,
        machineId: searchParamsState.machineId,
        projectId: searchParamsState.projectId,
        sourceKey: searchParamsState.sourceKey,
    }),
    navigation: {
        canGoBack: () => navigationState.canGoBack,
        goBack: () => navigationState.goBack(),
    },
    router: {
        back: () => routerState.back(),
        navigate: (value: unknown) => routerState.navigate(value),
        replace: (value: unknown) => routerState.replace(value),
        setParams: (value: unknown) => {
            Object.assign(searchParamsState, value);
            return routerState.setParams(value);
        },
    },
});

const expoRouterModule = {
    ...expoRouterMock.module,
    // 全局查询随每条模拟路由重置，不能让工厂上一次 setParams 的覆盖值污染下一条路由。
    useGlobalSearchParams: () => ({ ...searchParamsState }),
    usePathname: () => React.useSyncExternalStore(
        (listener) => {
            pathListeners.listeners.add(listener);
            return () => {
                pathListeners.listeners.delete(listener);
            };
        },
        () => pathState.pathname,
        () => pathState.pathname,
    ),
};

vi.mock('expo-router', () => expoRouterModule);

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Animated: {
            Value: class {
                _value: number;
                constructor(value: number) {
                    this._value = value;
                }
                setValue(value: number) {
                    this._value = value;
                }
                interpolate(config: Record<string, unknown>) {
                    return { __type: 'interpolate', value: this._value, config };
                }
            },
            timing: vi.fn((_value: unknown, config: { toValue: number }) => {
                let complete: ((result: { finished: boolean }) => void) | undefined;
                const timing = {
                    toValue: config.toValue,
                    start: vi.fn((callback?: (result: { finished: boolean }) => void) => {
                        complete = callback;
                    }),
                    stop: vi.fn(),
                    finish: (finished = true) => {
                        complete?.({ finished });
                    },
                };
                animatedTimingState.timings.push(timing);
                return timing;
            }),
            View: ({ children, ...props }: any) => React.createElement('AnimatedView', props, children),
        },
        View: ({ children, ...props }: any) => React.createElement('View', props, children),
        Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
        Platform: {
            get OS() {
                return platformState.os;
            },
            select: (values: Record<string, unknown>) => values[platformState.os] ?? values.native ?? values.default,
        },
    });
});

vi.mock('react-native-gesture-handler', async () => {
    const { createGestureHandlerMock } = await import('@/dev/testkit/mocks/gestureHandler');
    return createGestureHandlerMock({
        onGestureCreated: (gesture) => {
            gestureHandlerState.gestures.push(gesture);
        },
    });
});

// Reanimated animations run on the UI thread and are opaque to a node test; the shared
// stub collapses `withSpring` to identity, which cannot tell an animated return to rest
// from a snap. Recording the targets keeps that one distinction observable.
vi.mock('react-native-reanimated', async () => {
    const actual = await import('@/dev/reactNativeReanimatedStub');
    return {
        ...actual,
        withSpring: <T,>(value: T): T => {
            reanimatedSpringState.targets.push(value);
            return value;
        },
    };
});

vi.mock('expo-haptics', () => ({
    ImpactFeedbackStyle: { Light: 'light' },
    NotificationFeedbackType: { Error: 'error' },
    impactAsync: (style: string) => {
        hapticsState.impacts.push(style);
        return Promise.resolve();
    },
    notificationAsync: () => Promise.resolve(),
    selectionAsync: () => {
        hapticsState.selections += 1;
        return Promise.resolve();
    },
}));

vi.mock('react-native-worklets', () => ({
    scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => authState,
    getCurrentAuth: () => null,
}));

vi.mock('@/hooks/ui/useTabState', () => ({
    useTabState: () => tabState,
}));

vi.mock('@/utils/platform/responsive', () => ({
    useDeviceType: () => deviceTypeState.value,
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string, scope?: { scopeKind?: string; serverId?: string | null }) => {
        if (featureId === 'terminal.embeddedPty') {
            return featureState.terminalEmbeddedPtyEnabled
                && (
                    featureState.terminalEmbeddedPtyServerId == null
                    || (scope?.scopeKind === 'spawn' && scope.serverId === featureState.terminalEmbeddedPtyServerId)
                );
        }
        return false;
    },
}));

vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => reducedMotionState.value,
}));

vi.mock('@/hooks/ui/useKeyboardHeight', () => ({
    useKeyboardHeight: () => keyboardHeightState.value,
}));

vi.mock('@/components/ui/navigation/TabBar', () => ({
    TabBar: (props: Record<string, unknown>) => {
        tabBarRenderState.renderSpy(props);
        return React.createElement('TabBar', props);
    },
}));

vi.mock('./bars/SessionCockpitTabBar', () => ({
    SessionCockpitTabBar: (props: Record<string, unknown>) => React.createElement('SessionCockpitTabBar', props),
}));

// The picker's own surface (rows, scrim, dissolve) is asserted in its own suite; here it
// stands in for "the host mounted the second axis", which is a placement decision.
vi.mock('./lateralSwipe/SessionCockpitLateralPicker', () => ({
    SessionCockpitLateralPicker: () => React.createElement('SessionCockpitLateralPicker'),
}));

const storageMock = createStorageModuleStub({
    useSetting: (key: string) => React.useSyncExternalStore(
        (listener) => {
            storageListeners.listeners.add(listener);
            return () => {
                storageListeners.listeners.delete(listener);
            };
        },
        () => readSettingValue(key),
        () => readSettingValue(key),
    ),
    useLocalSetting: (key: string) => React.useSyncExternalStore(
        (listener) => {
            storageListeners.listeners.add(listener);
            return () => {
                storageListeners.listeners.delete(listener);
            };
        },
        () => readLocalSettingValue(key),
        () => readLocalSettingValue(key),
    ),
    useLocalSettingMutable: (key: string) => {
        if (key === 'sessionLastMobileSurfaceBySessionId') {
            return [
                settingsState.sessionLastMobileSurfaceBySessionId,
                (value: Record<string, string> | null) => {
                    settingsState.sessionLastMobileSurfaceBySessionId = value;
                    storageMutators.setSessionLastMobileSurfaceBySessionId(value);
                    notifyStorageListeners();
                },
            ];
        }
        return [null, vi.fn()];
    },
    useSessionMetadata: (sessionId: string) => sessionMetadataState.bySessionId[sessionId] ?? null,
    useSessionLastMobileSurface: (sessionId: string | null) => {
        if (!sessionId) return null;
        return settingsState.sessionLastMobileSurfaceBySessionId?.[sessionId] ?? null;
    },
    usePersistSessionLastMobileSurface: () => (sessionId: string, surface: string) => {
        const nextValue = {
            ...(settingsState.sessionLastMobileSurfaceBySessionId ?? {}),
            [sessionId]: surface,
        };
        settingsState.sessionLastMobileSurfaceBySessionId = nextValue;
        storageMutators.setSessionLastMobileSurfaceBySessionId(nextValue);
        notifyStorageListeners();
    },
    useSettingMutable: (key: string) => {
        if (key === 'mobileWorkspaceExperienceV1') {
            return [
                settingsState.mobileWorkspaceExperienceV1,
                (value: 'classic' | 'cockpit') => {
                    settingsState.mobileWorkspaceExperienceV1 = value;
                    storageMutators.setMobileWorkspaceExperience(value);
                    notifyStorageListeners();
                },
            ];
        }
        return [readSettingValue(key), vi.fn()];
    },
});

vi.mock('@/sync/domains/state/storage', () => storageMock);

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession', () => ({
    usePreferredServerIdForSession: () => featureState.resolvedServerId,
}));

function readSettingValue(key: string): unknown {
    if (key === 'mobileWorkspaceExperienceV1') {
        return settingsState.mobileWorkspaceExperienceV1;
    }
    if (key === 'sessionCockpitSwipeNavigationEnabled') {
        return settingsState.sessionCockpitSwipeNavigationEnabled;
    }
    return null;
}

function readLocalSettingValue(key: string): unknown {
    if (key === 'sessionLastMobileSurfaceBySessionId') {
        return settingsState.sessionLastMobileSurfaceBySessionId;
    }
    if (key === 'embeddedTerminalDockLocation') {
        return settingsState.embeddedTerminalDockLocation;
    }
    return null;
}

function notifyStorageListeners(): void {
    for (const listener of storageListeners.listeners) {
        listener();
    }
}

function notifyPathListeners(): void {
    for (const listener of pathListeners.listeners) {
        listener();
    }
}

/** Freezes an on-screen session order the way the list surface does when the user leaves it. */
function publishVisibleSessionOrder(sessionIds: readonly string[]): void {
    const cursor = buildSessionNavigationCursor({
        identity: { origin: 'session-list', sourceScopeKey: 'all', storageKind: 'all' },
        items: sessionIds.map((sessionId) => ({ type: 'session', session: { id: sessionId } })),
        nowMs: 1_000,
    });
    if (!cursor) throw new Error('test setup: cursor needs at least two sessions');
    publishSessionNavigationCursor(cursor);
}

function findLateralPanGesture(): TestGestureChain | null {
    for (const gesture of gestureHandlerState.gestures) {
        const pan = findGestureByKind(gesture, 'pan');
        if (pan?.__config.testId === 'session-cockpit-lateral-swipe') return pan;
    }
    return null;
}

async function renderCockpitBandOnSession(sessionId: string) {
    pathState.pathname = `/session/${sessionId}`;
    searchParamsState.id = sessionId;
    settingsState.mobileWorkspaceExperienceV1 = 'cockpit';

    const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
    return renderScreen(<MobileBottomChromeHost />);
}

describe('MobileBottomChromeHost', () => {
    afterEach(() => {
        standardCleanup();
        routerState.replace.mockReset();
        routerState.navigate.mockReset();
        routerState.back.mockReset();
        routerState.setParams.mockReset();
        navigationState.canGoBack = null;
        navigationState.goBack.mockReset();
        animatedTimingState.timings = [];
        tabState.setActiveTab.mockReset();
        tabBarRenderState.renderSpy.mockReset();
        storageMutators.setSessionLastMobileSurfaceBySessionId.mockReset();
        storageMutators.setMobileWorkspaceExperience.mockReset();
        gestureHandlerState.gestures = [];
        storageListeners.listeners.clear();
        pathListeners.listeners.clear();
        pathState.pathname = '/';
        searchParamsState.id = undefined;
        searchParamsState.mobileSurface = undefined;
        searchParamsState.serverId = undefined;
        searchParamsState.sourceSurface = undefined;
        searchParamsState.machineId = undefined;
        searchParamsState.projectId = undefined;
        searchParamsState.sourceKey = undefined;
        authState.isAuthenticated = true;
        settingsState.mobileWorkspaceExperienceV1 = undefined;
        settingsState.sessionLastMobileSurfaceBySessionId = null;
        settingsState.embeddedTerminalDockLocation = 'sidebar';
        settingsState.sessionCockpitSwipeNavigationEnabled = true;
        deviceTypeState.value = 'phone';
        featureState.terminalEmbeddedPtyEnabled = true;
        featureState.terminalEmbeddedPtyServerId = null;
        featureState.resolvedServerId = 'server-session';
        keyboardHeightState.value = 0;
        platformState.os = 'ios';
        sessionMetadataState.bySessionId = {};
        hapticsState.impacts = [];
        hapticsState.selections = 0;
        reducedMotionState.value = false;
        resetSessionNavigationCursorForTests();
    });

    it('renders the main app tab bar on the root sessions route', async () => {
        pathState.pathname = '/';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        const bar = screen.tree.findByType('TabBar' as never);
        expect(bar.props.activeTab).toBe('sessions');
    });

    it('keeps three equal navigation targets without duplicating the header new-session action', async () => {
        pathState.pathname = '/';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        expect(screen.tree.findByType('TabBar' as never).props.trailingAccessory).toBeUndefined();

        pathState.pathname = '/settings';
        await act(async () => {
            notifyPathListeners();
        });

        expect(screen.tree.findByType('TabBar' as never).props.trailingAccessory).toBeUndefined();
    });

    it('keeps the bar mounted under an overlay route instead of tearing it down', async () => {
        pathState.pathname = '/';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);
        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);

        // `/new` is presented OVER the sessions list, not instead of it. Recomputing chrome for the
        // overlay route resolved "no tab, no session" and removed the bar, so closing the composer
        // had to rebuild it afterwards — which read as the bar arriving late rather than never
        // having left. Frozen, it stays mounted behind the composer and needs no re-entry at all.
        pathState.pathname = '/new';
        await act(async () => {
            notifyPathListeners();
        });

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);

        pathState.pathname = '/';
        await act(async () => {
            notifyPathListeners();
        });

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);
    });

    it('suppresses frozen chrome above the Android floating new-session composer', async () => {
        platformState.os = 'android';
        pathState.pathname = '/';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost newSessionRendersFloatingComposer />);
        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);

        pathState.pathname = '/new';
        await act(async () => {
            notifyPathListeners();
        });

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(0);

        pathState.pathname = '/';
        await act(async () => {
            notifyPathListeners();
        });

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);
        expect(animatedTimingState.timings).toHaveLength(0);
    });

    it('keeps frozen chrome under the Android new-session wizard modal', async () => {
        platformState.os = 'android';
        pathState.pathname = '/';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        pathState.pathname = '/new';
        await act(async () => {
            notifyPathListeners();
        });

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);
    });

    it('fades the bar out rather than cutting it when chrome genuinely resolves to nothing', async () => {
        pathState.pathname = '/';
        keyboardHeightState.value = 0;

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);
        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);

        // The keyboard opening is a real teardown, not an overlay: the bar has to leave. It should
        // dissolve the way every bar-to-bar change does rather than vanish between two frames.
        keyboardHeightState.value = 320;
        await act(async () => {
            notifyPathListeners();
        });

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);
    });

    it('does not rerender main app tabs for cockpit-only storage updates', async () => {
        pathState.pathname = '/';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const onRender = vi.fn();
        await renderScreen(
            <React.Profiler id="mobile-bottom-chrome" onRender={onRender}>
                <MobileBottomChromeHost />
            </React.Profiler>,
        );

        expect(onRender).toHaveBeenCalledTimes(1);

        settingsState.sessionLastMobileSurfaceBySessionId = { 'session-1': 'git' };
        await act(async () => {
            notifyStorageListeners();
        });

        expect(onRender).toHaveBeenCalledTimes(1);
    });

    it('treats the root route as the sessions tab in legacy active-tab resolution', async () => {
        const { resolveMobileBottomChromeActiveTab } = await import('./MobileBottomChromeHost');

        expect(resolveMobileBottomChromeActiveTab('/')).toBe('sessions');
    });

    it('opens the existing computers route without persisting a desktop tab', async () => {
        pathState.pathname = '/';
        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);
        act(() => screen.tree.findByType('TabBar' as never).props.onTabPress('machines'));
        expect(routerState.navigate).toHaveBeenCalledWith('/settings/machines');
        expect(tabState.setActiveTab).not.toHaveBeenCalled();
    });

    it('keeps computers selected separately from the account subtree', async () => {
        pathState.pathname = '/settings/machines';
        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);
        const bar = screen.tree.findByType('TabBar' as never);
        expect(bar.props.activeTab).toBe('machines');
        act(() => bar.props.onTabPress('settings'));
        expect(routerState.navigate).toHaveBeenCalledWith('/settings');
        expect(tabState.setActiveTab).not.toHaveBeenCalled();
    });

    it('renders the main app tab bar on authenticated routed main surfaces', async () => {
        pathState.pathname = '/settings';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        const bar = screen.tree.findByType('TabBar' as never);
        expect(bar.props.activeTab).toBe('settings');
    });

    it('navigates main app tab presses before tab persistence settles', async () => {
        pathState.pathname = '/settings';
        let resolvePersistence: () => void = () => {};
        const persistence = new Promise<void>((resolve) => {
            resolvePersistence = resolve;
        });
        tabState.setActiveTab.mockReturnValueOnce(persistence);

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        const bar = screen.tree.findByType('TabBar' as never);
        act(() => {
            void bar.props.onTabPress('sessions');
        });

        try {
            expect(tabState.setActiveTab).toHaveBeenCalledWith('sessions');
            expect(routerState.navigate).toHaveBeenCalledWith('/');
            expect(routerState.replace).not.toHaveBeenCalled();
        } finally {
            resolvePersistence();
            await act(async () => {
                await Promise.resolve();
            });
        }
    });

    it('ignores a press on the already selected main app tab', async () => {
        pathState.pathname = '/settings';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        const bar = screen.tree.findByType('TabBar' as never);
        act(() => {
            void bar.props.onTabPress('settings');
        });

        expect(routerState.navigate).not.toHaveBeenCalled();
        expect(routerState.replace).not.toHaveBeenCalled();
        expect(tabState.setActiveTab).not.toHaveBeenCalled();
    });

    it('clears an explicit computer and project scope when reselecting the sessions homepage', async () => {
        pathState.pathname = '/';
        searchParamsState.machineId = 'machine-1';
        searchParamsState.projectId = 'project-1';
        searchParamsState.serverId = 'server-1';
        searchParamsState.sourceKey = 'codex:user';
        try {
            const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
            const screen = await renderScreen(<MobileBottomChromeHost />);
            act(() => { screen.tree.findByType('TabBar' as never).props.onTabPress('sessions'); });
            expect(routerState.setParams).toHaveBeenCalledWith({ machineId: undefined, projectId: undefined, serverId: undefined, sourceKey: undefined });
            expect(searchParamsState.machineId).toBeUndefined();
            expect(searchParamsState.projectId).toBeUndefined();
            expect(searchParamsState.serverId).toBeUndefined();
            expect(searchParamsState.sourceKey).toBeUndefined();
            expect(routerState.navigate).not.toHaveBeenCalled();
            expect(tabState.setActiveTab).not.toHaveBeenCalled();
        } finally {
            searchParamsState.machineId = undefined;
            searchParamsState.projectId = undefined;
            searchParamsState.sourceKey = undefined;
        }
    });

    it('resets a selected routed main app tab to its root route when reselected', async () => {
        pathState.pathname = '/settings/session';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        const bar = screen.tree.findByType('TabBar' as never);
        act(() => {
            void bar.props.onTabPress('settings');
        });

        expect(routerState.navigate).toHaveBeenCalledWith('/settings');
        expect(routerState.replace).not.toHaveBeenCalled();
        expect(tabState.setActiveTab).not.toHaveBeenCalled();
    });

    it('returns to the last routed settings surface after switching away through the main tab bar', async () => {
        pathState.pathname = '/settings/session';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        const settingsBar = screen.tree.findByType('TabBar' as never);
        act(() => {
            void settingsBar.props.onTabPress('sessions');
        });

        expect(routerState.navigate).toHaveBeenCalledWith('/');
        expect(tabState.setActiveTab).toHaveBeenCalledWith('sessions');

        pathState.pathname = '/';
        await act(async () => {
            notifyPathListeners();
        });

        routerState.navigate.mockClear();
        tabState.setActiveTab.mockClear();

        const sessionsBar = screen.tree.findByType('TabBar' as never);
        act(() => {
            void sessionsBar.props.onTabPress('settings');
        });

        expect(routerState.navigate).toHaveBeenCalledWith('/settings/session');
        expect(tabState.setActiveTab).not.toHaveBeenCalled();
        expect(routerState.replace).not.toHaveBeenCalled();
    });

    it('does not render chrome on desktop', async () => {
        pathState.pathname = '/';
        deviceTypeState.value = 'desktop';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(0);
        expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(0);
    });

    it('mobile web: renders session cockpit chrome from the global host on session routes', async () => {
        platformState.os = 'web';
        pathState.pathname = '/session/session-1/files';
        searchParamsState.id = 'session-1';
        settingsState.mobileWorkspaceExperienceV1 = 'cockpit';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(0);
        const cockpitBar = screen.tree.findByType('SessionCockpitTabBar' as never);
        expect(cockpitBar.props.sessionId).toBe('session-1');
        expect(cockpitBar.props.activeSurface).toBe('browse');
    });

    it('mobile web: does not let the transparent full-width chrome layer intercept content outside the floating bar', async () => {
        platformState.os = 'web';
        pathState.pathname = '/session/session-1';
        searchParamsState.id = 'session-1';
        settingsState.mobileWorkspaceExperienceV1 = 'cockpit';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        const cockpitBar = screen.tree.findByType('SessionCockpitTabBar' as never);
        let currentChromeLayer = cockpitBar.parent;
        while (currentChromeLayer && String(currentChromeLayer.type) !== 'View') {
            currentChromeLayer = currentChromeLayer.parent;
        }
        expect(String(currentChromeLayer?.type)).toBe('View');
        expect(currentChromeLayer?.props.pointerEvents).toBe('box-none');
    });

    it('mobile web: renders registered session cockpit chrome when the current session path is not a modeled surface route', async () => {
        platformState.os = 'web';
        pathState.pathname = '/session/session-1/file/src%2Findex.ts';
        searchParamsState.id = 'session-1';
        settingsState.mobileWorkspaceExperienceV1 = 'cockpit';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const {
            SessionCockpitChromeRegistryProvider,
            useSessionCockpitChromeRegister,
        } = await import('@/components/workspaceCockpit/session/SessionCockpitChromeRegistry');

        function RegisteredCockpitChrome() {
            const register = useSessionCockpitChromeRegister();
            React.useEffect(() => register({
                sessionId: 'session-1',
                activeSurface: 'browse',
                terminalTabAvailable: true,
                openDetailsTabCount: 2,
                switchSurface: vi.fn(),
            }), [register]);
            return null;
        }

        const screen = await renderScreen(
            <SessionCockpitChromeRegistryProvider>
                <RegisteredCockpitChrome />
                <MobileBottomChromeHost />
            </SessionCockpitChromeRegistryProvider>,
        );

        await act(async () => {
            await Promise.resolve();
        });

        const cockpitBar = screen.tree.findByType('SessionCockpitTabBar' as never);
        expect(cockpitBar.props.sessionId).toBe('session-1');
        expect(cockpitBar.props.activeSurface).toBe('browse');
        expect(cockpitBar.props.openDetailsTabCount).toBe(2);
    });

    it('mobile web: shows session cockpit chrome when cockpit mode is enabled while already viewing a session', async () => {
        platformState.os = 'web';
        pathState.pathname = '/session/session-1';
        searchParamsState.id = 'session-1';
        settingsState.mobileWorkspaceExperienceV1 = 'classic';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(0);

        settingsState.mobileWorkspaceExperienceV1 = 'cockpit';
        await act(async () => {
            notifyStorageListeners();
        });

        const cockpitBar = screen.tree.findByType('SessionCockpitTabBar' as never);
        expect(cockpitBar.props.sessionId).toBe('session-1');
        expect(cockpitBar.props.activeSurface).toBe('chat');
    });

    it('mobile web: falls back to route replacement for cockpit tab presses before the navigator bridge is ready', async () => {
        platformState.os = 'web';
        pathState.pathname = '/session/session-1/files';
        searchParamsState.id = 'session-1';
        searchParamsState.serverId = 'server-session';
        settingsState.mobileWorkspaceExperienceV1 = 'cockpit';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        const cockpitBar = screen.tree.findByType('SessionCockpitTabBar' as never);
        act(() => {
            cockpitBar.props.onSurfacePress('git');
        });

        expect(storageMutators.setSessionLastMobileSurfaceBySessionId).toHaveBeenCalledWith({
            'session-1': 'git',
        });
        expect(routerState.replace).toHaveBeenCalledWith('/session/session-1/git?serverId=server-session');
    });

    it('mobile web: keeps cockpit tab switches inside the navigator bridge when it is ready', async () => {
        platformState.os = 'web';
        pathState.pathname = '/session/session-1/file/src%2Findex.ts';
        searchParamsState.id = 'session-1';
        searchParamsState.serverId = 'server-session';
        settingsState.mobileWorkspaceExperienceV1 = 'cockpit';
        const switchSurface = vi.fn();

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const {
            SessionCockpitChromeRegistryProvider,
            useSessionCockpitChromeRegister,
        } = await import('@/components/workspaceCockpit/session/SessionCockpitChromeRegistry');

        function RegisteredCockpitChrome() {
            const register = useSessionCockpitChromeRegister();
            React.useEffect(() => register({
                sessionId: 'session-1',
                activeSurface: 'browse',
                terminalTabAvailable: true,
                openDetailsTabCount: 0,
                switchSurface,
            }), [register]);
            return null;
        }

        const screen = await renderScreen(
            <SessionCockpitChromeRegistryProvider>
                <RegisteredCockpitChrome />
                <MobileBottomChromeHost />
            </SessionCockpitChromeRegistryProvider>,
        );

        await act(async () => {
            await Promise.resolve();
        });

        const cockpitBar = screen.tree.findByType('SessionCockpitTabBar' as never);
        act(() => {
            cockpitBar.props.onSurfacePress('git');
        });

        expect(switchSurface).toHaveBeenCalledWith('git');
        expect(routerState.replace).not.toHaveBeenCalled();
    });

    it('does not attach old cockpit gestures or mutate settings on native phone session routes', async () => {
        pathState.pathname = '/session/session-1/files';
        searchParamsState.id = 'session-1';
        settingsState.mobileWorkspaceExperienceV1 = 'cockpit';
        publishVisibleSessionOrder(['session-0', 'session-1', 'session-2']);
        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);
        expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(0);
        expect(gestureHandlerState.gestures).toHaveLength(0);
        expect(storageMutators.setMobileWorkspaceExperience).not.toHaveBeenCalled();
        expect(routerState.navigate).not.toHaveBeenCalled();
    });

    it('hides main app chrome while the software keyboard is visible', async () => {
        pathState.pathname = '/';
        keyboardHeightState.value = 260;

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(0);
        expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(0);
    });

    it('mobile web: keeps session cockpit chrome mounted while the software keyboard is visible', async () => {
        platformState.os = 'web';
        pathState.pathname = '/session/session-1';
        searchParamsState.id = 'session-1';
        settingsState.mobileWorkspaceExperienceV1 = 'cockpit';
        keyboardHeightState.value = 260;

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(0);
        const cockpitBar = screen.tree.findByType('SessionCockpitTabBar' as never);
        expect(cockpitBar.props.sessionId).toBe('session-1');
        expect(cockpitBar.props.activeSurface).toBe('chat');
    });

    it('mobile web: keeps both main and cockpit bars in the global host during the route swap animation', async () => {
        platformState.os = 'web';
        vi.useFakeTimers();
        try {
            pathState.pathname = '/';

            const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
            const screen = await renderScreen(<MobileBottomChromeHost />);

            expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);

            pathState.pathname = '/session/session-1';
            searchParamsState.id = 'session-1';
            await act(async () => {
                notifyPathListeners();
            });

            expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);
            expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(1);
            expect(animatedTimingState.timings.find((timing) => timing.toValue === 1)).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('mobile web: shows the target chrome immediately when returning to the sessions list', async () => {
        platformState.os = 'web';
        vi.useFakeTimers();
        try {
            pathState.pathname = '/session/session-1/files';

            const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
            const screen = await renderScreen(<MobileBottomChromeHost />);

            expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(1);

            pathState.pathname = '/';
            await act(async () => {
                notifyPathListeners();
            });

            expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(1);
            const bar = screen.tree.findByType('TabBar' as never);
            expect(bar.props.activeTab).toBe('sessions');
        } finally {
            vi.useRealTimers();
        }
    });

    describe('native phone classic workspace boundary', () => {
        it.each([
            { os: 'ios' as const, preference: undefined },
            { os: 'ios' as const, preference: 'cockpit' as const },
            { os: 'ios' as const, preference: 'classic' as const },
            { os: 'android' as const, preference: undefined },
            { os: 'android' as const, preference: 'cockpit' as const },
            { os: 'android' as const, preference: 'classic' as const },
        ])('keeps $os preference=$preference free of cockpit, captured-order swipes and picker', async ({ os, preference }) => {
            platformState.os = os;
            pathState.pathname = '/session/session-1';
            searchParamsState.id = 'session-1';
            settingsState.mobileWorkspaceExperienceV1 = preference;
            publishVisibleSessionOrder(['session-0', 'session-1', 'session-2']);
            const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
            const screen = await renderScreen(<MobileBottomChromeHost />);
            expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(0);
            expect(screen.findByTestId('session-cockpit-lateral-picker')).toBeNull();
            expect(gestureHandlerState.gestures).toHaveLength(0);
            expect(routerState.navigate).not.toHaveBeenCalled();
            expect(routerState.replace).not.toHaveBeenCalled();
            expect(storageMutators.setMobileWorkspaceExperience).not.toHaveBeenCalled();
        });

        it('does not activate native cockpit after a stored preference changes while the session is mounted', async () => {
            pathState.pathname = '/session/session-1';
            const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
            const screen = await renderScreen(<MobileBottomChromeHost />);
            settingsState.mobileWorkspaceExperienceV1 = 'cockpit';
            await act(async () => { notifyStorageListeners(); });
            expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(0);
            expect(gestureHandlerState.gestures).toHaveLength(0);
        });

        it('preserves the existing absence of phone cockpit chrome on tablets', async () => {
            deviceTypeState.value = 'tablet';
            pathState.pathname = '/session/session-1';
            settingsState.mobileWorkspaceExperienceV1 = 'cockpit';
            const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
            const screen = await renderScreen(<MobileBottomChromeHost />);
            expect(screen.tree.findAllByType('SessionCockpitTabBar' as never)).toHaveLength(0);
            expect(gestureHandlerState.gestures).toHaveLength(0);
        });
    });

    it('does not schedule chrome animations while switching within main app tabs', async () => {
        pathState.pathname = '/settings';

        const { MobileBottomChromeHost } = await import('./MobileBottomChromeHost');
        const screen = await renderScreen(<MobileBottomChromeHost />);

        pathState.pathname = '/friends';
        await act(async () => {
            notifyPathListeners();
        });

        expect(screen.tree.findAllByType('TabBar' as never)).toHaveLength(1);
        expect(animatedTimingState.timings).toHaveLength(0);
    });
});
