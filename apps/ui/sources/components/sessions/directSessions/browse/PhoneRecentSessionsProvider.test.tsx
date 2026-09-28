import * as React from 'react';
import { act } from 'react-test-renderer';
import type { DirectSessionCandidateDeleteResponse, DirectSessionsCandidatesListRequest, DirectSessionsCandidatesListResponse } from '@happier-dev/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareWarmCacheStorage, saveDirectSessionTranscriptWarmCache, clearDirectSessionTranscriptWarmCache } from '@/sync/domains/state/warmCachePersistence';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createReactNativeAppStateEmitter, createReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';
import { createReactNavigationNativeMock } from '@/dev/testkit/mocks/reactNavigation';
import { createModalModuleMock } from '@/dev/testkit/mocks/modal';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import { createUnistylesMock } from '@/dev/testkit/mocks/unistyles';
import { createSafeAreaContextMock } from '@/dev/testkit/mocks/nativeEnvironment';
import { createCapturingFlatListMock } from '@/dev/testkit/mocks/flashList';
import { installNewSessionComponentsCommonModuleMocks } from '../../new/components/newSessionComponentsTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const candidatesListSpy = vi.hoisted(() => vi.fn(async (_input: DirectSessionsCandidatesListRequest, _opts?: { serverId?: string | null }): Promise<DirectSessionsCandidatesListResponse> => ({
    ok: true,
    candidates: [
        {
            remoteSessionId: 'codex-session-1',
            title: 'Existing Codex Session',
            updatedAtMs: 1_700_000_000_000,
            activity: 'running',
            details: {
                path: '/tmp/worktree',
                codexBackendMode: 'appServer',
                source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' },
            },
        },
    ],
    nextCursor: null,
})));
const linkEnsureSpy = vi.hoisted(() => vi.fn(async () => ({
    ok: true,
    sessionId: 'happy-session-1',
    created: true,
})));
const projectsListSpy = vi.hoisted(() => vi.fn(async () => ({ ok: true, projects: [], nativeCreate: false, unavailableReason: 'desktop_native_create_unavailable' })));
const candidateDeleteSpy = vi.hoisted(() => vi.fn(async (): Promise<DirectSessionCandidateDeleteResponse> => ({
    ok: true as const,
    deleted: true as const,
})));
const routerPushSpy = vi.hoisted(() => vi.fn());
const routerNavigateSpy = vi.hoisted(() => vi.fn());
const routerBackSpy = vi.hoisted(() => vi.fn());
const modalAlertSpy = vi.hoisted(() => vi.fn());
const modalConfirmSpy = vi.hoisted(() => vi.fn(async () => true));
const profileMock = vi.hoisted(() => ({
    connectedServicesV2: [
        {
            serviceId: 'openai-codex',
            profiles: [{ profileId: 'work', status: 'connected' }],
        },
    ],
}));
const activeScopeState = vi.hoisted(() => ({ value: null as { serverId: string; accountId: string } | null }));
const cachedMachineDisplays = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const focusState = vi.hoisted(() => ({ value: true }));
const socketState = vi.hoisted(() => ({ status: 'connected' }));
const appStateBoundary = createReactNativeAppStateEmitter();
vi.mock('@react-navigation/native', () => ({
    ...createReactNavigationNativeMock(),
    useIsFocused: () => createReactNavigationNativeMock({ isFocused: focusState.value }).useIsFocused(),
}));
const settingsMock = vi.hoisted(() => ({
    phoneRecentSessionLimit: 50,
    connectedServicesProfileLabelByKey: {
        'openai-codex/work': 'Work Profile',
    },
}));
let machinesState = [
    { id: 'machine-1', active: true, metadata: { displayName: 'MacBook Pro', host: 'mbp.local' } },
    { id: 'machine-2', active: false, metadata: { displayName: 'Linux Box', host: 'linux.local' } },
];

const routeParams = vi.hoisted(() => ({ value: {} as Record<string, string> }));
const expoRouterMock = createExpoRouterMock({
    params: () => routeParams.value,
    router: { push: routerPushSpy, navigate: routerNavigateSpy, back: routerBackSpy },
});

installNewSessionComponentsCommonModuleMocks({
    reactNative: () => createReactNativeWebMock({
        Platform: { OS: 'android', select: (values: any) => values.android ?? values.default },
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
        AppState: appStateBoundary.appState,
        View: 'View',
        TextInput: 'TextInput',
        ActivityIndicator: 'ActivityIndicator',
        Pressable: 'Pressable',
        ScrollView: 'ScrollView',
        FlatList: createCapturingFlatListMock({ renderItems: true }).module.FlatList,
    }),
    unistyles: () => createUnistylesMock({
        theme: {
            colors: {
                text: '#000',
                textSecondary: '#666',
                textTertiary: '#444',
                divider: '#ddd',
                surface: '#fff',
                surfaceHigh: '#f5f5f5',
                surfacePressedOverlay: '#eee',
                success: '#0f0',
                accent: { orange: '#f90' },
                modal: { border: '#ddd' },
                shadow: { color: '#000' },
                groupped: { background: '#fff' },
                header: { tint: '#000' },
            },
        },
    }),
    router: () => expoRouterMock.module,
    text: () => createTextModuleMock({ translate: (key: string) => key }),
    modal: () => createModalModuleMock({
        spies: {
            alert: modalAlertSpy,
            confirm: modalConfirmSpy,
        },
    }).module,
    storage: () => createStorageModuleStub({
        useAllMachines: () => machinesState,
    }),
});

vi.mock('@/sync/store/hooks', () => ({
    useSessions: () => [],
    useSessionListViewData: () => [],
    useProfile: () => profileMock,
    useActiveServerAccountScope: () => activeScopeState.value,
    useSocketStatus: () => socketState,
    useSettings: () => settingsMock,
    useLocalSetting: (key: string) => key === 'uiItemDensity' ? 'comfortable' : undefined,
    useMachineDisplayById: () => cachedMachineDisplays.value,
    useIsDataReady: () => false,
}));

vi.mock('@/components/ui/lists/ItemList', () => createPassThroughModule(['ItemList']));
vi.mock('@/components/ui/lists/ItemGroup', () => createPassThroughModule(['ItemGroup']));
vi.mock('@/components/ui/lists/Item', () => createPassThroughModule(['Item']));
vi.mock('@/components/ui/lists/ItemRowActions', () => ({
    ItemRowActions: (props: Record<string, unknown>) => React.createElement('ItemRowActions', props),
}));
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => createPassThroughModule(['DropdownMenu']));
vi.mock('@/components/ui/popover', () => createPassThroughModule(['PopoverScope']));
vi.mock('@/components/ui/text/Text', () => createPassThroughModule(['Text', 'TextInput']));
vi.mock('@/components/ui/status/StatusDot', () => ({
    StatusDot: 'StatusDot',
}));

vi.mock('@/sync/ops/machineDirectSessions', () => ({
    machineDirectSessionsCandidatesList: candidatesListSpy,
    machineDirectSessionCandidateDelete: candidateDeleteSpy,
    machineDirectSessionLinkEnsure: linkEnsureSpy,
    machineDirectSessionsProjectsList: projectsListSpy,
}));

vi.mock('react-native-safe-area-context', () => createSafeAreaContextMock({ safeArea: { top: 0, bottom: 0, left: 0, right: 0 }, keyboard: { isVisible: false, height: 0 } }));


const prefetch = vi.hoisted(() => vi.fn(async (_input: any) => {}));
vi.mock('@/sync/sync', () => ({ sync: { prefetchPhoneRecentDirectSessions: prefetch } }));
vi.mock('@/utils/platform/platform', () => ({ isRunningOnMac: () => false }));

beforeEach(() => {
    vi.useFakeTimers();
    prefetch.mockClear(); candidatesListSpy.mockClear();
    activeScopeState.value = { serverId: 's', accountId: 'a' };
    socketState.status = 'connected'; focusState.value = false;
    machinesState = [{ id: 'machine-1', active: true, activeAt: Date.now(), metadata: { displayName: 'MacBook Pro', host: 'mbp.local' } }] as any;
    settingsMock.phoneRecentSessionLimit = 1;
    appStateBoundary.emit('active');
    candidatesListSpy.mockResolvedValue({ ok: true, capabilities: { deleteCandidate: false, linkWithoutOpening: true }, candidates: [
        { remoteSessionId: 'newer', title: 'Newer', updatedAtMs: 20, transcriptVersion: 'v2' },
        { remoteSessionId: 'older', title: 'Older', updatedAtMs: 10, transcriptVersion: 'v1' },
    ] });
});
afterEach(() => { vi.useRealTimers(); });

it('discovers and submits only global recent rows on another tab and invalidates a sleeping generation', async () => {
    const { PhoneRecentSessionsProvider } = await import('./PhoneRecentSessionsProvider');
    const screen = await renderScreen(<PhoneRecentSessionsProvider><ViewForTest /></PhoneRecentSessionsProvider>);
    await flushHookEffects();
    expect(candidatesListSpy).toHaveBeenCalled();
    expect(prefetch).toHaveBeenCalled();
    const call = prefetch.mock.calls.at(-1)![0] as any;
    expect(call.requests).toHaveLength(1);
    expect(call.requests[0]).toMatchObject({ link: { remoteSessionId: 'newer', openExisting: false }, transcriptVersion: 'v2', sourceUpdatedAtMs: 20 });
    expect(call.isCurrent()).toBe(true);
    await act(async () => { appStateBoundary.emit('background'); appStateBoundary.emit('active'); });
    expect(call.isCurrent()).toBe(false);
    await flushHookEffects();
    expect(prefetch.mock.calls.at(-1)![0].isCurrent()).toBe(true);
    await screen.unmount();
    expect(prefetch.mock.calls.at(-1)![0].isCurrent()).toBe(false);
});

it('does not prefetch when an old daemon omits the explicit no-open capability', async () => {
    candidatesListSpy.mockResolvedValue({ ok: true, candidates: [{ remoteSessionId: 'legacy', updatedAtMs: 1 }] });
    const { PhoneRecentSessionsProvider } = await import('./PhoneRecentSessionsProvider');
    const screen = await renderScreen(<PhoneRecentSessionsProvider><ViewForTest /></PhoneRecentSessionsProvider>);
    await flushHookEffects();
    expect(candidatesListSpy).toHaveBeenCalled();
    expect(prefetch.mock.calls.every(([input]) => input.requests.length === 0)).toBe(true);
    await screen.unmount();
});

/** 子内容代表另一页；测试不渲染首页，也不触发选择会话。 */
function ViewForTest() { return <React.Fragment />; }

it('fences disconnect and account replacement without reviving the old prefetch lifetime', async () => {
    const { PhoneRecentSessionsProvider } = await import('./PhoneRecentSessionsProvider');
    const content = () => <PhoneRecentSessionsProvider><ViewForTest /></PhoneRecentSessionsProvider>;
    const screen = await renderScreen(content());
    await flushHookEffects();
    const old = prefetch.mock.calls.at(-1)![0];
    socketState.status = 'disconnected';
    await screen.update(content());
    expect(old.isCurrent()).toBe(false);
    socketState.status = 'connected';
    await screen.update(content());
    await flushHookEffects();
    const restored = prefetch.mock.calls.at(-1)![0];
    expect(restored.isCurrent()).toBe(true);
    expect(restored.isCurrent).not.toBe(old.isCurrent);
    activeScopeState.value = { serverId: 's2', accountId: 'a2' };
    await screen.update(content());
    expect(restored.isCurrent()).toBe(false);
    await flushHookEffects();
    expect(prefetch.mock.calls.at(-1)![0]).toMatchObject({ serverId: 's2', accountId: 'a2' });
    await screen.unmount();
});

it('waits for all sources before applying one global recent cap', async () => {
    machinesState.push({ id: 'machine-3', active: true, activeAt: Date.now(), metadata: { displayName: 'Other' } } as any);
    const finishes: Array<(value: DirectSessionsCandidatesListResponse) => void> = [];
    candidatesListSpy.mockImplementation(async (input) => input.machineId === 'machine-3'
        ? await new Promise((resolve) => { finishes.push(resolve); })
        : { ok: true, capabilities: { deleteCandidate: false, linkWithoutOpening: true }, candidates: [{ remoteSessionId: 'first', updatedAtMs: 10, transcriptVersion: 'one' }] });
    const { PhoneRecentSessionsProvider } = await import('./PhoneRecentSessionsProvider');
    const screen = await renderScreen(<PhoneRecentSessionsProvider><ViewForTest /></PhoneRecentSessionsProvider>);
    await flushHookEffects();
    expect(prefetch.mock.calls.every(([input]) => input.requests.length === 0)).toBe(true);
    await act(async () => { for (const finish of finishes) finish({ ok: true, capabilities: { deleteCandidate: false, linkWithoutOpening: true }, candidates: [{ remoteSessionId: 'latest', updatedAtMs: 30, transcriptVersion: 'two' }] }); });
    await flushHookEffects();
    expect(prefetch.mock.calls.at(-1)![0].requests).toHaveLength(1);
    expect(prefetch.mock.calls.at(-1)![0].requests[0].link.remoteSessionId).toBe('latest');
    await screen.unmount();
});

it('submits an empty admission set when every source disappears', async () => {
    const { PhoneRecentSessionsProvider } = await import('./PhoneRecentSessionsProvider');
    const screen = await renderScreen(<PhoneRecentSessionsProvider><ViewForTest /></PhoneRecentSessionsProvider>);
    await flushHookEffects();
    expect(prefetch.mock.calls.some(([input]) => input.requests.length > 0)).toBe(true);
    machinesState = [];
    await screen.update(<PhoneRecentSessionsProvider><ViewForTest /></PhoneRecentSessionsProvider>);
    await flushHookEffects();
    expect(prefetch.mock.calls.at(-1)![0].requests).toEqual([]);
    await screen.unmount();
});

it('home consumes the global owners without starting a duplicate unfiltered discovery', async () => {
    const { PhoneRecentSessionsProvider } = await import('./PhoneRecentSessionsProvider');
    const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
    const screen = await renderScreen(<PhoneRecentSessionsProvider><ViewForTest /></PhoneRecentSessionsProvider>);
    await flushHookEffects();
    const count = candidatesListSpy.mock.calls.length;
    await screen.update(<PhoneRecentSessionsProvider><PhoneSessionsOverview /></PhoneRecentSessionsProvider>);
    await flushHookEffects();
    expect(candidatesListSpy).toHaveBeenCalledTimes(count);
    expect(screen.findByTestId('phone-sessions-overview')).not.toBeNull();
    await screen.unmount();
});

/** 能力被撤回后仍保留列表展示，但旧的预取选集合必须清空。 */
it('revokes admissions when a later discovery withdraws no-open capability', async () => {
    const { PhoneRecentSessionsProvider } = await import('./PhoneRecentSessionsProvider');
    const screen = await renderScreen(<PhoneRecentSessionsProvider><ViewForTest /></PhoneRecentSessionsProvider>);
    await flushHookEffects();
    expect(prefetch.mock.calls.at(-1)![0].requests.length).toBeGreaterThan(0);
    candidatesListSpy.mockResolvedValue({ ok: true, candidates: [{ remoteSessionId: 'newer', updatedAtMs: 30 }] });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await flushHookEffects();
    expect(prefetch.mock.calls.at(-1)![0].requests).toEqual([]);
    expect(linkEnsureSpy).not.toHaveBeenCalled();
    await screen.unmount();
});

/** 无文件版本时复用真实 LIST 轮次身份；渲染不会自行制造新的读取轮次。 */
it('forwards the real discovery identity unchanged across renders and replaces it only after LIST', async () => {
    candidatesListSpy.mockResolvedValue({ ok: true, capabilities: { deleteCandidate: false, linkWithoutOpening: true }, candidates: [{ remoteSessionId: 'no-token', updatedAtMs: 30 }] });
    const { PhoneRecentSessionsProvider } = await import('./PhoneRecentSessionsProvider');
    const content = () => <PhoneRecentSessionsProvider><ViewForTest /></PhoneRecentSessionsProvider>;
    const screen = await renderScreen(content());
    await flushHookEffects();
    const first = prefetch.mock.calls.at(-1)![0].requests[0];
    expect(first.transcriptVersion).toBeUndefined();
    expect(first.discoveryObservation).toEqual(expect.objectContaining({ requestSequence: expect.any(Number) }));
    const calls = candidatesListSpy.mock.calls.length;
    await screen.update(content());
    await flushHookEffects();
    expect(candidatesListSpy).toHaveBeenCalledTimes(calls);
    expect(prefetch.mock.calls.at(-1)![0].requests[0].discoveryObservation).toBe(first.discoveryObservation);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await flushHookEffects();
    expect(candidatesListSpy.mock.calls.length).toBeGreaterThan(calls);
    expect(prefetch.mock.calls.at(-1)![0].requests[0].discoveryObservation).not.toBe(first.discoveryObservation);
    await screen.unmount();
});
