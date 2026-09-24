import * as React from 'react';
import { act } from 'react-test-renderer';
import type { DirectSessionCandidateDeleteResponse, DirectSessionsCandidatesListRequest, DirectSessionsCandidatesListResponse } from '@happier-dev/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';
import { createModalModuleMock } from '@/dev/testkit/mocks/modal';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import { createUnistylesMock } from '@/dev/testkit/mocks/unistyles';
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
const settingsMock = vi.hoisted(() => ({
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
    router: { push: routerPushSpy, navigate: routerNavigateSpy },
});

installNewSessionComponentsCommonModuleMocks({
    reactNative: () => createReactNativeWebMock({
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
    useSettings: () => settingsMock,
    useLocalSetting: (key: string) => key === 'uiItemDensity' ? 'comfortable' : undefined,
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

const directSessionsBrowseScreenModulePromise = import('./DirectSessionsBrowseScreen');
const defaultCandidatesImplementation = candidatesListSpy.getMockImplementation()!;

type DropdownTriggerPresentation = Readonly<{
    title: string;
    subtitle?: string;
}>;

type DropdownMenuTestNode = Readonly<{
    props?: {
        itemRowProps?: {
            density?: unknown;
        };
        itemTrigger?: {
            itemProps?: {
                testID?: string;
                density?: unknown;
            };
            showSelectedDetail?: boolean;
            subtitleFormatter?: (presentation: DropdownTriggerPresentation) => string;
        };
        onSelect?: (value: string) => Promise<void> | void;
        popoverBoundaryRef?: React.RefObject<unknown> | null;
        selectedId?: string;
    };
}>;

function findDropdownMenuByTriggerTestId(
    screen: { findAllByType: (type: unknown) => DropdownMenuTestNode[] },
    testID: string,
): DropdownMenuTestNode | undefined {
    return screen.findAllByType('DropdownMenu').find((node) => node.props?.itemTrigger?.itemProps?.testID === testID);
}

type CandidateActionsProps = Readonly<{
    deleting: boolean;
    onDelete: () => void | Promise<void>;
}>;

function findCandidateActionsProps(
    screen: { findByTestId: (testID: string) => { props: Record<string, any> } | null },
    remoteSessionId: string,
): CandidateActionsProps | undefined {
    const rightElement = screen.findByTestId(`direct-session-candidate:${remoteSessionId}`)?.props.rightElement;
    const children = React.Children.toArray(rightElement?.props?.children) as React.ReactElement<CandidateActionsProps>[];
    return children.find((child) => typeof child?.props?.onDelete === 'function')?.props;
}

/** 通过真实搜索输入和防抖触发请求，保持 hook 与列表接线都在回归范围内。 */
async function changeBrowseSearch(
    screen: Pick<Awaited<ReturnType<typeof renderScreen>>, 'changeTextByTestId'>,
    query: string,
): Promise<void> {
    await act(async () => { screen.changeTextByTestId('direct-session-candidates-search-input', query); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flushHookEffects();
}

/** 使用真实协议允许的事实样例，故意让 activity 相反以验证手机没有沿用旧活跃度分类。 */
function phoneCandidate(remoteSessionId: string, state: 'running' | 'needs_input' | 'completed' | 'failed' | 'cancelled' | 'unknown', ageMs = 1000) {
    const checkedAtMs = Date.now() - 1;
    return {
        remoteSessionId, title: remoteSessionId, updatedAtMs: checkedAtMs - ageMs,
        activity: state === 'running' ? 'idle' as const : 'running' as const,
        details: {
            cwd: '/work/real-project',
            codexLifecycle: { v: 1 as const, state, eventAtMs: state === 'unknown' ? null : checkedAtMs - ageMs, checkedAtMs },
            source: { kind: 'codexHome' as const, home: 'user' as const, homePath: '/work/actual-home' },
        },
    };
}

describe('DirectSessionsBrowseScreen', () => {
    beforeEach(() => {
        projectsListSpy.mockReset().mockResolvedValue({ ok: true, projects: [], nativeCreate: false, unavailableReason: 'desktop_native_create_unavailable' });
        routeParams.value = {};
        activeScopeState.value = null;
        machinesState = [
            { id: 'machine-1', active: true, metadata: { displayName: 'MacBook Pro', host: 'mbp.local' } },
            { id: 'machine-2', active: false, metadata: { displayName: 'Linux Box', host: 'linux.local' } },
        ];
        candidatesListSpy.mockReset().mockImplementation(defaultCandidatesImplementation);
        linkEnsureSpy.mockClear();
        candidateDeleteSpy.mockClear();
        routerPushSpy.mockClear();
        routerNavigateSpy.mockClear();
        modalAlertSpy.mockClear();
        modalConfirmSpy.mockClear();
        modalConfirmSpy.mockResolvedValue(true);
    });

    it('keeps rows and allows recovery at the page footer after a stale cursor and refresh failure', async () => {
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'kept', updatedAtMs: 10 }], nextCursor: 'old-page' });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        await flushHookEffects();
        candidatesListSpy.mockResolvedValueOnce({ ok: false, errorCode: 'invalid_request', error: 'direct_sessions_list_refresh_required', refreshRequired: true });
        await screen.pressByTestIdAsync('direct-session-candidates-load-more');
        await flushHookEffects();
        expect(screen.findByTestId('direct-session-candidate:kept')).toBeTruthy();
        expect(screen.findByTestId('direct-session-candidates-list-changed')).toBeTruthy();
        expect(screen.findByTestId('direct-session-candidates-load-more')).toBeNull();
        expect(screen.findByTestId('direct-session-candidates-footer-recovery')).toBeTruthy();
        candidatesListSpy.mockRejectedValueOnce(new Error('offline'));
        await screen.pressByTestIdAsync('direct-session-candidates-footer-refresh');
        await flushHookEffects();
        expect(screen.findByTestId('direct-session-candidate:kept')).toBeTruthy();
        expect(screen.findByTestId('direct-session-candidates-footer-refresh')).toBeTruthy();
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'fresh', updatedAtMs: 20 }], nextCursor: 'new-page' });
        await screen.pressByTestIdAsync('direct-session-candidates-footer-refresh');
        await flushHookEffects();
        expect(screen.findByTestId('direct-session-candidate:kept')).toBeNull();
        expect(screen.findByTestId('direct-session-candidate:fresh')).toBeTruthy();
        expect(screen.findByTestId('direct-session-candidates-list-changed')).toBeNull();
        expect(screen.findByTestId('direct-session-candidates-footer-recovery')).toBeNull();
        expect(candidatesListSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty('cursor');
    });

    it('keeps rows and the same continuation retry after ordinary page failure', async () => {
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'kept', updatedAtMs: 10 }], nextCursor: 'retry-page' });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        await flushHookEffects();
        candidatesListSpy.mockRejectedValueOnce(new Error('temporary failure'));
        await screen.pressByTestIdAsync('direct-session-candidates-load-more');
        await flushHookEffects();
        expect(screen.findByTestId('direct-session-candidate:kept')).toBeTruthy();
        expect(screen.findByTestId('direct-session-candidates-list-changed')).toBeNull();
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'next', updatedAtMs: 5 }], nextCursor: null });
        await screen.pressByTestIdAsync('direct-session-candidates-load-more');
        await flushHookEffects();
        expect(candidatesListSpy.mock.calls.at(-1)?.[0]).toHaveProperty('cursor', 'retry-page');
        expect(screen.findByTestId('direct-session-candidate:next')).toBeTruthy();
    });

    it('binds the actual server and ignores an older server continuation after switching', async () => {
        activeScopeState.value = { serverId: 'server-a', accountId: 'account' };
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'a', updatedAtMs: 10 }], nextCursor: 'a-page' });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        await flushHookEffects();
        expect(candidatesListSpy).toHaveBeenLastCalledWith(expect.anything(), { serverId: 'server-a' });
        let finish!: (result: DirectSessionsCandidatesListResponse) => void;
        candidatesListSpy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        await screen.pressByTestIdAsync('direct-session-candidates-load-more');
        activeScopeState.value = { serverId: 'server-b', accountId: 'account' };
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'b', updatedAtMs: 20 }], nextCursor: null });
        await act(async () => { screen.update(<DirectSessionsBrowseScreen interaction="pickRemoteSessionId" />); });
        await flushHookEffects();
        expect(candidatesListSpy).toHaveBeenLastCalledWith(expect.not.objectContaining({ cursor: 'a-page' }), { serverId: 'server-b' });
        await act(async () => { finish({ ok: true, candidates: [{ remoteSessionId: 'stale-a', updatedAtMs: 30 }], nextCursor: null }); });
        await flushHookEffects();
        expect(screen.findByTestId('direct-session-candidate:b')).toBeTruthy();
        expect(screen.findByTestId('direct-session-candidate:a')).toBeNull();
        expect(screen.findByTestId('direct-session-candidate:stale-a')).toBeNull();
    });

    it('does not append during full search and uses only its returned cursor afterwards', async () => {
        vi.useFakeTimers();
        try {
            const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
            const screen = await renderScreen(<DirectSessionsBrowseScreen />);
            await flushHookEffects();
            candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'fast', updatedAtMs: 10 }], nextCursor: 'fast-page', searchIncomplete: true });
            let finish!: (result: DirectSessionsCandidatesListResponse) => void;
            candidatesListSpy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
            await changeBrowseSearch(screen, 'needle');
            const callsBefore = candidatesListSpy.mock.calls.length;
            expect(screen.findByTestId('direct-session-candidates-load-more')?.props.disabled).toBe(true);
            await screen.pressByTestIdAsync('direct-session-candidates-load-more');
            expect(candidatesListSpy.mock.calls.length).toBe(callsBefore);
            await act(async () => { finish({ ok: true, candidates: [{ remoteSessionId: 'full', updatedAtMs: 20 }], nextCursor: 'full-page' }); });
            await flushHookEffects();
            candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [], nextCursor: null });
            await screen.pressByTestIdAsync('direct-session-candidates-load-more');
            await flushHookEffects();
            expect(candidatesListSpy.mock.calls.at(-1)?.[0]).toHaveProperty('cursor', 'full-page');
        } finally { vi.useRealTimers(); }
    });

    it('shows incomplete empty browse coverage without claiming there are no candidates', async () => {
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [], nextCursor: null, searchIncomplete: true });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        await flushHookEffects();
        const texts = screen.findAllByType('Text').map((node) => node.props.children);
        expect(texts).toContain('directSessions.browseListIncomplete');
        expect(screen.findByTestId('direct-session-candidates-refresh')).toBeTruthy();
        expect(texts).not.toContain('directSessions.browseNoCandidates');
    });

    it('ignores an older append result after refreshing the same source', async () => {
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'kept', updatedAtMs: 10 }], nextCursor: 'old-page', searchIncomplete: true });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        await flushHookEffects();
        let finish!: (result: DirectSessionsCandidatesListResponse) => void;
        candidatesListSpy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        await screen.pressByTestIdAsync('direct-session-candidates-load-more');
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'refreshed', updatedAtMs: 20 }], nextCursor: null });
        await screen.pressByTestIdAsync('direct-session-candidates-refresh');
        await flushHookEffects();
        await act(async () => { finish({ ok: true, candidates: [{ remoteSessionId: 'stale-append', updatedAtMs: 5 }], nextCursor: 'bad-page' }); });
        await flushHookEffects();
        expect(screen.findByTestId('direct-session-candidate:refreshed')).toBeTruthy();
        expect(screen.findByTestId('direct-session-candidate:stale-append')).toBeNull();
        expect(screen.findByTestId('direct-session-candidates-load-more')).toBeNull();
    });

    it('loads candidates for the default machine and provider', async () => {
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);

        await flushHookEffects();

        expect(candidatesListSpy).toHaveBeenCalledWith({
            machineId: 'machine-1',
            providerId: 'codex',
            source: { kind: 'codexHome', home: 'user' },
            limit: 50,
        });

        const machineDropdown = findDropdownMenuByTriggerTestId(screen, 'direct-session-machine-picker-trigger');
        const providerDropdown = findDropdownMenuByTriggerTestId(screen, 'direct-session-provider-picker-trigger');
        const sourceDropdown = findDropdownMenuByTriggerTestId(screen, 'direct-session-source-picker-trigger');
        const popoverScopes = screen.findAllByType('PopoverScope' as any);
        const popoverBoundaryRef = popoverScopes[0]?.props?.boundaryRef;

        expect(machineDropdown).toBeTruthy();
        expect(providerDropdown).toBeTruthy();
        expect(sourceDropdown).toBeTruthy();
        expect(popoverScopes).toHaveLength(1);
        expect(popoverBoundaryRef).toBeTruthy();
        expect(machineDropdown?.props?.popoverBoundaryRef).toBe(popoverBoundaryRef);
        expect(providerDropdown?.props?.popoverBoundaryRef).toBe(popoverBoundaryRef);
        expect(sourceDropdown?.props?.popoverBoundaryRef).toBe(popoverBoundaryRef);
        const itemGroups = screen.findAllByType('ItemGroup' as any);
        expect(itemGroups[0]?.props.title).toBe('directSessions.browseFiltersTitle');
        expect(machineDropdown?.props?.itemTrigger?.itemProps?.density).toBeUndefined();
        expect(providerDropdown?.props?.itemTrigger?.itemProps?.density).toBeUndefined();
        expect(sourceDropdown?.props?.itemTrigger?.itemProps?.density).toBeUndefined();
        expect(machineDropdown?.props?.itemTrigger?.showSelectedDetail).toBe(false);
        expect(providerDropdown?.props?.itemTrigger?.showSelectedDetail).toBe(false);
        expect(sourceDropdown?.props?.itemTrigger?.showSelectedDetail).toBe(false);
        expect(machineDropdown?.props?.itemRowProps?.density).toBeUndefined();
        expect(providerDropdown?.props?.itemRowProps?.density).toBeUndefined();
        expect(sourceDropdown?.props?.itemRowProps?.density).toBeUndefined();
        expect(typeof machineDropdown?.props?.itemTrigger?.subtitleFormatter).toBe('function');
        expect(typeof providerDropdown?.props?.itemTrigger?.subtitleFormatter).toBe('function');
        expect(typeof sourceDropdown?.props?.itemTrigger?.subtitleFormatter).toBe('function');
        expect(machineDropdown!.props?.itemTrigger?.subtitleFormatter?.({
            title: 'Leeroys-MacBook-Pro',
            subtitle: 'Active now',
        })).toBe('Leeroys-MacBook-Pro · Active now');
        expect(providerDropdown!.props?.itemTrigger?.subtitleFormatter?.({
            title: 'Codex',
            subtitle: undefined,
        })).toBe('Codex');
        expect(sourceDropdown!.props?.itemTrigger?.subtitleFormatter?.({
            title: 'My Codex home',
            subtitle: undefined,
        })).toBe('My Codex home');

        const candidateItem = screen.findByTestId('direct-session-candidate:codex-session-1');
        expect(candidateItem).toBeTruthy();
        expect(candidateItem?.props.title).toBe('Existing Codex Session');
        const candidateSubtitle = candidateItem?.props.subtitle;
        expect(React.isValidElement(candidateSubtitle)).toBe(true);
        const candidateSubtitleLines = React.Children.toArray((candidateSubtitle as any).props.children) as any[];
        expect(String(candidateSubtitleLines[0]?.props?.children)).toContain('directSessions.browseActivityRunningNow');
        expect(String(candidateSubtitleLines[2]?.props?.children)).toContain('/tmp/worktree');
        expect(candidateSubtitleLines.map((line) => String(line?.props?.children ?? '')).join('\n')).not.toContain('codex-session-1');
        expect(candidateItem?.props.density).toBeUndefined();
        expect(candidateItem?.props.rightElement).toBeTruthy();
        const badgeChildren = React.Children.toArray(candidateItem!.props.rightElement.props.children);
        const statusDot = badgeChildren.find((child: any) => child?.type === 'StatusDot');
        const badgeText = badgeChildren.find((child: any) => typeof child?.props?.children === 'string');
        expect(String((badgeText as any)?.props?.children)).toBe('directSessions.browseActivityRunning');
        expect((statusDot as any)?.props?.isPulsing).toBe(true);
    });

    it('shows last-seen metadata and a recent badge for recently active sessions', async () => {
        candidatesListSpy.mockResolvedValueOnce({
            ok: true,
            candidates: [
                {
                    remoteSessionId: 'claude-session-1',
                    title: 'Recent Claude Session',
                    updatedAtMs: 1_700_000_000_000,
                    activity: 'active_recently',
                    details: {
                        path: '/tmp/claude-project',
                        codexBackendMode: 'appServer',
                        source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' },
                    },
                },
            ],
            nextCursor: null,
        } as any);
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;

        const screen = await renderScreen(<DirectSessionsBrowseScreen />);

        await flushHookEffects();

        const candidateItem = screen.findByTestId('direct-session-candidate:claude-session-1');
        expect(candidateItem).toBeTruthy();
        const candidateSubtitle = candidateItem?.props.subtitle;
        expect(React.isValidElement(candidateSubtitle)).toBe(true);
        const candidateSubtitleLines = React.Children.toArray((candidateSubtitle as any).props.children) as any[];
        expect(String(candidateSubtitleLines[0]?.props?.children)).toMatch(/^time\./);
        expect(String(candidateSubtitleLines[2]?.props?.children)).toContain('/tmp/claude-project');
        const badgeChildren = React.Children.toArray(candidateItem!.props.rightElement.props.children);
        const statusDot = badgeChildren.find((child: any) => child?.type === 'StatusDot');
        const badgeText = badgeChildren.find((child: any) => typeof child?.props?.children === 'string');
        expect(String((badgeText as any)?.props?.children)).toBe('directSessions.browseActivityRecent');
        expect((statusDot as any)?.props?.isPulsing).toBe(false);
    });

    it('prefers the first active machine over an earlier offline machine when loading candidates', async () => {
        machinesState = [
            { id: 'machine-offline', active: false, metadata: { displayName: 'Offline Mac', host: 'offline.local' } },
            { id: 'machine-active', active: true, metadata: { displayName: 'Active Mac', host: 'active.local' } },
        ];
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;

        const screen = await renderScreen(<DirectSessionsBrowseScreen />);

        await flushHookEffects();

        expect(candidatesListSpy).toHaveBeenCalledWith({
            machineId: 'machine-active',
            providerId: 'codex',
            source: { kind: 'codexHome', home: 'user' },
            limit: 50,
        });

        const machineDropdown = findDropdownMenuByTriggerTestId(screen, 'direct-session-machine-picker-trigger');
        expect(machineDropdown?.props?.selectedId).toBe('machine-active');
    });

    it('searches provider candidates through the daemon with the search field', async () => {
        candidatesListSpy.mockResolvedValueOnce({
            ok: true,
            candidates: [
                {
                    remoteSessionId: 'codex-session-1',
                    title: 'Refactor direct session UX',
                    updatedAtMs: 1_700_000_000_000,
                    activity: 'running',
                    details: { path: '/tmp/happier/dev', codexBackendMode: 'appServer', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' } },
                },
                {
                    remoteSessionId: 'codex-session-2',
                    title: 'Investigate opencode startup',
                    updatedAtMs: 1_700_000_000_000,
                    activity: 'idle',
                    details: { path: '/tmp/opencode', codexBackendMode: 'appServer', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' } },
                },
            ],
            nextCursor: null,
        });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;

        const screen = await renderScreen(<DirectSessionsBrowseScreen />);

        await flushHookEffects();

        const searchInput = screen.findByTestId('direct-session-candidates-search-input');
        expect(searchInput).toBeTruthy();
        expect(searchInput!.props.placeholder).toBe('directSessions.browseSearchPlaceholder');

        vi.useFakeTimers();
        try {
            candidatesListSpy.mockResolvedValueOnce({
                ok: true,
                candidates: [
                    {
                        remoteSessionId: 'codex-hidden-session-9',
                        title: 'Fast filesystem result',
                        updatedAtMs: 1_700_000_000_000,
                        activity: 'idle',
                        details: { path: '/tmp/deep-result', codexBackendMode: 'appServer', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' } },
                    },
                    {
                        remoteSessionId: 'codex-fast-only-session-8',
                        title: 'Fast-only filesystem result',
                        updatedAtMs: 1_699_999_999_000,
                        activity: 'idle',
                        details: { path: '/tmp/fast-only-result', codexBackendMode: 'exec', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' } },
                    },
                ],
                nextCursor: null,
                searchIncomplete: true,
            });
            let resolveAugmentedSearch!: (value: Awaited<ReturnType<typeof candidatesListSpy>>) => void;
            const augmentedSearchPromise = new Promise<Awaited<ReturnType<typeof candidatesListSpy>>>((resolve) => {
                resolveAugmentedSearch = resolve;
            });
            candidatesListSpy.mockImplementationOnce(() => augmentedSearchPromise);

            await act(async () => {
                searchInput!.props.onChangeText('codex-hidden-session-9');
            });
            expect(candidatesListSpy).toHaveBeenCalledTimes(1);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(250);
            });
            await flushHookEffects();

            expect(candidatesListSpy).toHaveBeenNthCalledWith(2, {
                machineId: 'machine-1',
                providerId: 'codex',
                source: { kind: 'codexHome', home: 'user' },
                limit: 50,
                searchTerm: 'codex-hidden-session-9',
                searchMode: 'fast',
            });
            expect(candidatesListSpy).toHaveBeenNthCalledWith(3, {
                machineId: 'machine-1',
                providerId: 'codex',
                source: { kind: 'codexHome', home: 'user' },
                limit: 50,
                searchTerm: 'codex-hidden-session-9',
                searchMode: 'full',
            });
            expect(screen.findByTestId('direct-session-candidates-search-augmenting')).toBeTruthy();

            await act(async () => {
                resolveAugmentedSearch({
                    ok: true,
                    candidates: [
                        {
                            remoteSessionId: 'codex-hidden-session-9',
                            title: 'Augmented app-server result',
                            updatedAtMs: 1_700_000_000_000,
                            activity: 'idle',
                            details: { path: '/tmp/deep-result', codexBackendMode: 'appServer', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' } },
                        },
                        {
                            remoteSessionId: 'codex-augmented-only-session-7',
                            title: 'Augmented-only app-server result',
                            updatedAtMs: 1_699_999_998_000,
                            activity: 'idle',
                            details: { path: '/tmp/augmented-only-result', codexBackendMode: 'appServer', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' } },
                        },
                    ],
                    nextCursor: null,
                });
                await augmentedSearchPromise;
            });
            await flushHookEffects();

            const candidateItem = screen.findByTestId('direct-session-candidate:codex-hidden-session-9');
            expect(candidateItem).toBeTruthy();
            expect(candidateItem?.props.testID).toBe('direct-session-candidate:codex-hidden-session-9');
            expect(candidateItem?.props.title).toBe('Augmented app-server result');
            expect(screen.findByTestId('direct-session-candidate:codex-fast-only-session-8')).toBeTruthy();
            expect(screen.findByTestId('direct-session-candidate:codex-augmented-only-session-7')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['budget', 'failure', 'throw'] as const)('keeps incomplete search visible after full search ends with %s', async (outcome) => {
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        await flushHookEffects();
        vi.useFakeTimers();
        try {
            candidatesListSpy.mockResolvedValueOnce({
                ok: true, candidates: [{ remoteSessionId: 'fast-match', title: 'Fast match', updatedAtMs: 10 }],
                nextCursor: 'search-page-2', searchIncomplete: true,
            });
            if (outcome === 'throw') candidatesListSpy.mockRejectedValueOnce(new Error('augmentation unavailable'));
            else candidatesListSpy.mockResolvedValueOnce(outcome === 'failure'
                ? { ok: false, errorCode: 'internal_error', error: 'augmentation unavailable' }
                : { ok: true, candidates: [], nextCursor: null, searchIncomplete: true });

            await changeBrowseSearch(screen, 'match');

            expect(screen.findByTestId('direct-session-candidates-search-incomplete')).toBeTruthy();
            expect(screen.findByTestId('direct-session-candidates-search-augmenting')).toBeNull();
            expect(screen.findByTestId('direct-session-candidate:fast-match')).toBeTruthy();
            expect(screen.findByTestId('direct-session-candidates-load-more')).toBeTruthy();

            // 完整响应以及清空搜索都必须清除旧提示，不把上一轮状态带入新结果。
            candidatesListSpy.mockResolvedValueOnce({
                ok: true, candidates: [{ remoteSessionId: 'complete-match', updatedAtMs: 11 }], nextCursor: null,
            });
            await changeBrowseSearch(screen, 'complete');
            expect(screen.findByTestId('direct-session-candidates-search-incomplete')).toBeNull();
            expect(screen.findByTestId('direct-session-candidate:fast-match')).toBeNull();
            expect(screen.findByTestId('direct-session-candidate:complete-match')).toBeTruthy();
            await changeBrowseSearch(screen, '');
            expect(screen.findByTestId('direct-session-candidates-search-incomplete')).toBeNull();
            expect(screen.findByTestId('direct-session-candidate:codex-session-1')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not present an incomplete empty search as no matches and clears it with the query', async () => {
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        await flushHookEffects();
        vi.useFakeTimers();
        try {
            candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [], nextCursor: null, searchIncomplete: true });
            candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [], nextCursor: null, searchIncomplete: true });
            await changeBrowseSearch(screen, 'outside-search-budget');
            expect(screen.findByTestId('direct-session-candidates-search-incomplete')).toBeTruthy();
            expect(screen.findAllByType('Text').some((node) => node.props.children === 'directSessions.browseNoSearchResults')).toBe(false);
            await changeBrowseSearch(screen, '');
            expect(screen.findByTestId('direct-session-candidates-search-incomplete')).toBeNull();
            expect(screen.findByTestId('direct-session-candidate:codex-session-1')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('deduplicates appended candidates in the current source while keeping existing row order', async () => {
        candidatesListSpy.mockResolvedValueOnce({
            ok: true, nextCursor: 'page-2', candidates: [
                { remoteSessionId: 'first', title: 'First', updatedAtMs: 30 },
                { remoteSessionId: 'overlap', title: 'Old title', updatedAtMs: 20 },
            ],
        });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        await flushHookEffects();
        candidatesListSpy.mockResolvedValueOnce({
            ok: true, nextCursor: null, candidates: [
                { remoteSessionId: 'overlap', title: 'Updated title', updatedAtMs: 40 },
                { remoteSessionId: 'older', title: 'Older', updatedAtMs: 10 },
            ],
        });
        await screen.pressByTestIdAsync('direct-session-candidates-load-more');
        await flushHookEffects();
        const rows = screen.findAllByType('Item').filter((node) => node.props.testID?.startsWith('direct-session-candidate:'));
        expect(rows.map((node) => node.props.testID)).toEqual([
            'direct-session-candidate:first', 'direct-session-candidate:overlap', 'direct-session-candidate:older',
        ]);
        expect(screen.findByTestId('direct-session-candidate:overlap')?.props.title).toBe('Updated title');
        expect(screen.findByTestId('direct-session-candidates-load-more')).toBeNull();
        expect(candidatesListSpy).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'page-2', limit: 50 }));
    });

    it('ignores incomplete augmentation from an older search after a new search completes', async () => {
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        await flushHookEffects();
        vi.useFakeTimers();
        try {
            candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [], nextCursor: null, searchIncomplete: true });
            let resolveOldSearch!: (result: DirectSessionsCandidatesListResponse) => void;
            candidatesListSpy.mockImplementationOnce(() => new Promise((resolve) => { resolveOldSearch = resolve; }));
            await changeBrowseSearch(screen, 'old');
            candidatesListSpy.mockResolvedValueOnce({
                ok: true, candidates: [{ remoteSessionId: 'new-match', updatedAtMs: 20 }], nextCursor: null,
            });
            await changeBrowseSearch(screen, 'new');
            await act(async () => {
                resolveOldSearch({ ok: true, candidates: [{ remoteSessionId: 'stale-match', updatedAtMs: 30 }], nextCursor: null, searchIncomplete: true });
            });
            await flushHookEffects();
            expect(screen.findByTestId('direct-session-candidates-search-incomplete')).toBeNull();
            expect(screen.findByTestId('direct-session-candidate:new-match')).toBeTruthy();
            expect(screen.findByTestId('direct-session-candidate:stale-match')).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('links the selected provider session and navigates to the Happier session', async () => {
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);

        await flushHookEffects();

        const candidateItem = screen.findByTestId('direct-session-candidate:codex-session-1');
        expect(candidateItem).toBeTruthy();

        await screen.pressByTestIdAsync('direct-session-candidate:codex-session-1');

        expect(linkEnsureSpy).toHaveBeenCalledWith({
            machineId: 'machine-1',
            providerId: 'codex',
            remoteSessionId: 'codex-session-1',
            titleHint: 'Existing Codex Session',
            directoryHint: '/tmp/worktree',
            codexBackendMode: 'appServer',
            source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' },
        });
        expect(routerNavigateSpy).toHaveBeenCalledWith('/session/happy-session-1', expect.any(Object));
        expect(routerNavigateSpy.mock.calls[0]?.[1]?.dangerouslySingular?.()).toBe('session');
    });

    it('switches to the codex connected-service source before linking', async () => {
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        const tree = screen.tree;

        await flushHookEffects();
        candidatesListSpy.mockClear();

        const sourceDropdown = findDropdownMenuByTriggerTestId(screen, 'direct-session-source-picker-trigger');
        expect(sourceDropdown).toBeTruthy();

        await act(async () => {
            await sourceDropdown!.props?.onSelect?.('codex:connected-service:openai-codex:work');
        });

        candidatesListSpy.mockResolvedValueOnce({
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
                        source: {
                            kind: 'codexHome',
                            home: 'connectedService',
                            connectedServiceId: 'openai-codex',
                            connectedServiceProfileId: 'work',
                            homePath: '/tmp/codex-work-home',
                        } as any,
                    },
                },
            ],
            nextCursor: null,
        });
        await act(async () => {
            tree.update(<DirectSessionsBrowseScreen />);
        });
        await flushHookEffects();

        expect(candidatesListSpy).toHaveBeenCalledWith({
            machineId: 'machine-1',
            providerId: 'codex',
            source: { kind: 'codexHome', home: 'connectedService', connectedServiceId: 'openai-codex', connectedServiceProfileId: 'work' },
            limit: 50,
        });

        const candidateItem = screen.findByTestId('direct-session-candidate:codex-session-1');
        expect(candidateItem).toBeTruthy();

        await screen.pressByTestIdAsync('direct-session-candidate:codex-session-1');

        expect(linkEnsureSpy).toHaveBeenCalledWith({
            machineId: 'machine-1',
            providerId: 'codex',
            remoteSessionId: 'codex-session-1',
            titleHint: 'Existing Codex Session',
            directoryHint: '/tmp/worktree',
            codexBackendMode: 'appServer',
            source: expect.objectContaining({ kind: 'codexHome', home: 'connectedService', connectedServiceId: 'openai-codex', connectedServiceProfileId: 'work' } as any),
        });
    });

    it('recovers when the selected machine disappears from the machine list', async () => {
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        const tree = screen.tree;

        await flushHookEffects();

        const machineDropdown = findDropdownMenuByTriggerTestId(screen, 'direct-session-machine-picker-trigger');

        await act(async () => {
            await machineDropdown!.props?.onSelect?.('machine-2');
        });

        expect(candidatesListSpy).toHaveBeenLastCalledWith({
            machineId: 'machine-2',
            providerId: 'codex',
            source: { kind: 'codexHome', home: 'user' },
            limit: 50,
        });

        candidatesListSpy.mockClear();
        machinesState = [{ id: 'machine-1', active: true, metadata: { displayName: 'MacBook Pro', host: 'mbp.local' } }];

        await act(async () => {
            tree.update(<DirectSessionsBrowseScreen key="rerendered" />);
        });
        await flushHookEffects();

        const rerenderedMachineDropdown = findDropdownMenuByTriggerTestId(screen, 'direct-session-machine-picker-trigger');

        expect(rerenderedMachineDropdown).toBeTruthy();
        expect(rerenderedMachineDropdown!.props?.selectedId).toBe('machine-1');
        expect(candidatesListSpy).toHaveBeenCalledWith({
            machineId: 'machine-1',
            providerId: 'codex',
            source: { kind: 'codexHome', home: 'user' },
            limit: 50,
        });
    });

    it('does not allow stale requests to overwrite newer candidate state after rapid filter changes', async () => {
        let slowResolve: ((value: any) => void) | null = null;
        const slowPromise = new Promise((resolve) => {
            slowResolve = resolve;
        });

        candidatesListSpy.mockResolvedValueOnce({
            ok: true,
            candidates: [
                {
                    remoteSessionId: 'initial-session-1',
                    title: 'Initial Session',
                    updatedAtMs: 1_700_000_000_000,
                    activity: 'running',
                    details: { path: '/tmp/initial', codexBackendMode: 'appServer', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' } },
                },
            ],
            nextCursor: null,
        });

        candidatesListSpy.mockImplementationOnce(async () => {
            await slowPromise;
            return {
                ok: true,
                candidates: [
                    {
                        remoteSessionId: 'stale-session-1',
                        title: 'Stale Session',
                        updatedAtMs: 1_700_000_000_000,
                        activity: 'idle',
                        details: { path: '/tmp/stale', codexBackendMode: 'appServer', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' } },
                    },
                ],
                nextCursor: null,
            };
        });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;

        const screen = await renderScreen(<DirectSessionsBrowseScreen />);
        const tree = screen.tree;

        await flushHookEffects();

        const machineDropdown = findDropdownMenuByTriggerTestId(screen, 'direct-session-machine-picker-trigger');

        // Switch to machine-2 (this starts a slow request)
        await act(async () => {
            await machineDropdown!.props?.onSelect?.('machine-2');
        });

        // Immediately switch back to machine-1 (this completes quickly)
        candidatesListSpy.mockResolvedValueOnce({
            ok: true,
            candidates: [
                {
                    remoteSessionId: 'fresh-session-1',
                    title: 'Fresh Session',
                    updatedAtMs: 1_700_000_000_000,
                    activity: 'running',
                    details: { path: '/tmp/fresh', codexBackendMode: 'appServer', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/custom-home' } },
                },
            ],
            nextCursor: null,
        });

        await act(async () => {
            await machineDropdown!.props?.onSelect?.('machine-1');
        });

        await flushHookEffects();

        // Now resolve the slow request from machine-2
        slowResolve!({
            ok: true,
            candidates: [
                {
                    remoteSessionId: 'stale-session-1',
                    title: 'Stale Session',
                    updatedAtMs: 1_700_000_000_000,
                    activity: 'idle',
                    details: { path: '/tmp/stale', codexBackendMode: 'appServer' },
                },
            ],
            nextCursor: null,
        });
        await flushHookEffects();

        // The displayed candidates should be from machine-1, not the stale machine-2 request
        const candidateItem = screen.findByTestId('direct-session-candidate:fresh-session-1');
        expect(candidateItem).toBeTruthy();
        expect(candidateItem?.props.title).toBe('Fresh Session');
        expect(candidateItem?.props.testID).toBe('direct-session-candidate:fresh-session-1');
    });

    it('can be used as a locked picker that returns a remote session id without linking', async () => {
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;

        const onPickRemoteSessionId = vi.fn();

        const screen = await renderScreen(
            <DirectSessionsBrowseScreen
                interaction="pickRemoteSessionId"
                lockScope={{
                    machineId: 'machine-2',
                    serverId: 'server-1',
                    providerId: 'codex',
                    source: { kind: 'codexHome', home: 'user' },
                }}
                onPickRemoteSessionId={onPickRemoteSessionId}
            />,
        );

        await flushHookEffects();

        expect(candidatesListSpy).toHaveBeenCalledWith({
            machineId: 'machine-2',
            providerId: 'codex',
            source: { kind: 'codexHome', home: 'user' },
            limit: 50,
        }, { serverId: 'server-1' });

        expect(findDropdownMenuByTriggerTestId(screen, 'direct-session-machine-picker-trigger')).toBeUndefined();
        expect(findDropdownMenuByTriggerTestId(screen, 'direct-session-provider-picker-trigger')).toBeUndefined();
        expect(findDropdownMenuByTriggerTestId(screen, 'direct-session-source-picker-trigger')).toBeUndefined();

        const candidateItem = screen.findByTestId('direct-session-candidate:codex-session-1');
        expect(candidateItem).toBeTruthy();
        if (!candidateItem) {
            throw new Error('expected candidate item');
        }

        await act(async () => {
            await candidateItem.props.onPress?.();
        });

        expect(onPickRemoteSessionId).toHaveBeenCalledWith('codex-session-1');
        expect(routerPushSpy).not.toHaveBeenCalled();
        expect(linkEnsureSpy).not.toHaveBeenCalled();
    });

    it('hides provider deletion when the candidate listing did not negotiate it', async () => {
        candidatesListSpy.mockResolvedValueOnce({
            ok: true,
            candidates: [{ remoteSessionId: 'remote-1', title: 'Provider session', updatedAtMs: 1 }],
            nextCursor: null,
            capabilities: { deleteCandidate: false },
        });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(
            <DirectSessionsBrowseScreen
                interaction="pickRemoteSessionId"
                lockScope={{
                    machineId: 'machine-1',
                    providerId: 'kimi',
                    source: { kind: 'acpSessionList', cwd: '/work/repo' },
                }}
            />,
        );
        await flushHookEffects();

        expect(screen.findAllByType('ItemRowActions')).toHaveLength(0);
        expect(candidateDeleteSpy).not.toHaveBeenCalled();
    });

    it('confirms and deletes one provider-owned candidate, showing pending state and removing only after success', async () => {
        candidatesListSpy.mockResolvedValueOnce({
            ok: true,
            candidates: [{ remoteSessionId: 'remote-1', title: 'Provider session', updatedAtMs: 1 }],
            nextCursor: null,
            capabilities: { deleteCandidate: true },
        });
        let resolveDelete!: (value: { ok: true; deleted: true }) => void;
        const pendingDelete = new Promise<{ ok: true; deleted: true }>((resolve) => { resolveDelete = resolve; });
        candidateDeleteSpy.mockImplementationOnce(() => pendingDelete);

        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(
            <DirectSessionsBrowseScreen
                interaction="pickRemoteSessionId"
                lockScope={{
                    machineId: 'machine-1',
                    serverId: 'server-1',
                    providerId: 'kimi',
                    source: { kind: 'acpSessionList', cwd: '/work/repo' },
                }}
            />,
        );
        await flushHookEffects();

        const candidateActions = findCandidateActionsProps(screen, 'remote-1');
        expect(candidateActions).toBeTruthy();

        await act(async () => {
            candidateActions?.onDelete();
        });
        expect(candidateDeleteSpy).toHaveBeenCalledWith({
            machineId: 'machine-1',
            providerId: 'kimi',
            source: { kind: 'acpSessionList', cwd: '/work/repo' },
            remoteSessionId: 'remote-1',
        }, { serverId: 'server-1' });
        expect(screen.findByTestId('direct-session-candidate:remote-1')?.props.loading).toBe(true);

        await act(async () => {
            resolveDelete({ ok: true, deleted: true });
            await pendingDelete;
        });
        expect(screen.findByTestId('direct-session-candidate:remote-1')).toBeNull();
        expect(candidateDeleteSpy).toHaveBeenCalledTimes(1);
    });

    it('disables every provider delete action while keeping pending loading on only the deleting row', async () => {
        candidatesListSpy.mockResolvedValueOnce({
            ok: true,
            candidates: [
                { remoteSessionId: 'remote-1', title: 'First provider session', updatedAtMs: 2 },
                { remoteSessionId: 'remote-2', title: 'Second provider session', updatedAtMs: 1 },
            ],
            nextCursor: null,
            capabilities: { deleteCandidate: true },
        });
        let resolveDelete!: (value: { ok: true; deleted: true }) => void;
        const pendingDelete = new Promise<{ ok: true; deleted: true }>((resolve) => { resolveDelete = resolve; });
        candidateDeleteSpy.mockImplementationOnce(() => pendingDelete);

        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(
            <DirectSessionsBrowseScreen
                interaction="pickRemoteSessionId"
                lockScope={{
                    machineId: 'machine-1',
                    providerId: 'kimi',
                    source: { kind: 'acpSessionList', cwd: '/work/repo' },
                }}
            />,
        );
        await flushHookEffects();

        await act(async () => {
            findCandidateActionsProps(screen, 'remote-1')?.onDelete();
        });

        expect(findCandidateActionsProps(screen, 'remote-1')?.deleting).toBe(true);
        expect(findCandidateActionsProps(screen, 'remote-2')?.deleting).toBe(true);
        expect(screen.findByTestId('direct-session-candidate:remote-1')?.props.loading).toBe(true);
        expect(screen.findByTestId('direct-session-candidate:remote-2')?.props.loading).toBe(false);

        await act(async () => {
            resolveDelete({ ok: true, deleted: true });
            await pendingDelete;
        });
        expect(findCandidateActionsProps(screen, 'remote-2')?.deleting).toBe(false);
        expect(screen.findByTestId('direct-session-candidate:remote-2')?.props.loading).toBe(false);
    });

    it('preserves a provider candidate and makes retry available after deletion fails', async () => {
        candidatesListSpy.mockResolvedValueOnce({
            ok: true,
            candidates: [{ remoteSessionId: 'remote-1', title: 'Provider session', updatedAtMs: 1 }],
            nextCursor: null,
            capabilities: { deleteCandidate: true },
        });
        candidateDeleteSpy.mockResolvedValueOnce({
            ok: false,
            errorCode: 'internal_error',
            error: 'provider refused deletion',
        });

        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(
            <DirectSessionsBrowseScreen
                interaction="pickRemoteSessionId"
                lockScope={{
                    machineId: 'machine-1',
                    providerId: 'kimi',
                    source: { kind: 'acpSessionList', cwd: '/work/repo' },
                }}
            />,
        );
        await flushHookEffects();

        const candidateActions = findCandidateActionsProps(screen, 'remote-1');
        await act(async () => {
            candidateActions?.onDelete();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.findByTestId('direct-session-candidate:remote-1')).toBeTruthy();
        expect(modalAlertSpy).toHaveBeenCalledWith('common.error', 'provider refused deletion');
        expect(findCandidateActionsProps(screen, 'remote-1')?.deleting).toBe(false);
    });
    it('embeds phone history without source controls or a nested scroll view and preserves opening', async () => {
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen
            lockScope={{ machineId: 'machine-1', serverId: 'server-phone', providerId: 'codex', source: { kind: 'codexHome', home: 'user' } }}
            phonePresentation={{ searchQuery: '', includeCandidate: () => true }}
        />);
        await flushHookEffects();
        expect(screen.findAllByType('ItemList')).toHaveLength(0);
        expect(screen.findAllByType('DropdownMenu')).toHaveLength(0);
        expect(screen.findByTestId('direct-session-candidates-search-input')).toBeNull();
        await act(async () => { screen.pressByTestId('direct-session-candidate:codex-session-1'); });
        expect(linkEnsureSpy).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'machine-1' }), { serverId: 'server-phone' });
    });

    it('aggregates the account computers into one list without scope selectors and expands search on demand', async () => {
        activeScopeState.value = { serverId: 'phone-server', accountId: 'phone-account' };
        const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
        const screen = await renderScreen(<PhoneSessionsOverview />);
        await flushHookEffects();
        expect(new Set(candidatesListSpy.mock.calls.map(([request]) => request.machineId))).toEqual(new Set(['machine-1', 'machine-2']));
        expect(candidatesListSpy).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'machine-1', providerId: 'codex' }), { serverId: 'phone-server' });
        expect(screen.findAllByType('FlatList')).toHaveLength(1);
        expect(screen.findAllByType('DropdownMenu')).toHaveLength(0);
        expect(screen.findByTestId('phone-sessions-search')).toBeNull();
        await act(async () => { screen.pressByTestId('phone-sessions-search-toggle'); });
        expect(screen.findByTestId('phone-sessions-search')).not.toBeNull();
        expect(screen.findByTestId('phone-sessions-status:running')?.props.accessibilityState).toEqual({ selected: true });
        expect(screen.findByTestId('phone-sessions-status:all')).toBeNull();
        expect(screen.findByTestId('phone-sessions-status:completed')).not.toBeNull();
        expect(screen.findByTestId('direct-session-provider-picker-trigger')).toBeNull();
    });

    it('classifies explicit facts across computers, sorts one list and opens the exact original source', async () => {
        activeScopeState.value = { serverId: 'phone-server', accountId: 'phone-account' };
        machinesState = machinesState.map((machine) => ({ ...machine, active: true }));
        candidatesListSpy.mockImplementation(async (request) => ({
            ok: true,
            candidates: request.source.kind === 'codexHome' && request.source.home === 'user'
                ? request.machineId === 'machine-1'
                    ? [phoneCandidate('running-older', 'running', 3000), phoneCandidate('wait', 'needs_input'), phoneCandidate('done', 'completed'), phoneCandidate('unknown', 'unknown'), phoneCandidate('failed', 'failed')]
                    : [phoneCandidate('running-newer', 'running')]
                : [],
            nextCursor: null,
        }));
        const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
        const screen = await renderScreen(<PhoneSessionsOverview />);
        await flushHookEffects();
        const list = () => screen.findAllByType('FlatList')[0]!;
        expect(list().props.data.map((row: any) => row.candidate.remoteSessionId)).toEqual(['running-newer', 'running-older']);
        const requestCount = candidatesListSpy.mock.calls.length;
        const newer = list().props.data[0];
        await act(async () => { screen.pressByTestId(`phone-session:${newer.key}`); });
        expect(linkEnsureSpy).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'machine-2', remoteSessionId: 'running-newer', source: { kind: 'codexHome', home: 'user', homePath: '/work/actual-home' } }), { serverId: 'phone-server' });
        await act(async () => { screen.pressByTestId('phone-sessions-status:needs_input'); });
        expect(list().props.data.map((row: any) => row.candidate.remoteSessionId)).toEqual(['wait']);
        await act(async () => { screen.pressByTestId('phone-sessions-status:completed'); });
        expect(list().props.data.map((row: any) => row.candidate.remoteSessionId)).toEqual(['done']);
        expect(candidatesListSpy).toHaveBeenCalledTimes(requestCount);
        await act(async () => { screen.pressByTestId('phone-sessions-history-link'); });
        expect(routerPushSpy).toHaveBeenCalledWith('/settings/machines');
    });

    it('keeps a fast computer pageable while another source is slow, and restores rows after a failed page', async () => {
        activeScopeState.value = { serverId: 's', accountId: 'a' };
        let finishSlow!: (value: DirectSessionsCandidatesListResponse) => void;
        let failPage = true;
        candidatesListSpy.mockImplementation(async (request) => {
            if (request.source.kind !== 'codexHome' || request.source.home !== 'user') return { ok: true, candidates: [], nextCursor: null };
            if (request.machineId === 'machine-2') return new Promise((resolve) => { finishSlow = resolve; });
            if (request.cursor && failPage) throw new Error('synthetic page disconnected');
            return { ok: true, candidates: [phoneCandidate(request.cursor ? 'page-2' : 'page-1', 'running')], nextCursor: request.cursor ? null : 'fast-page' };
        });
        const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
        const screen = await renderScreen(<PhoneSessionsOverview />);
        await flushHookEffects();
        expect(screen.findByTestId('phone-sessions-load-more')?.props.disabled).toBe(false);
        await act(async () => { screen.pressByTestId('phone-sessions-load-more'); });
        await flushHookEffects();
        expect(screen.findAllByType('FlatList')[0]?.props.data.map((row: any) => row.candidate.remoteSessionId)).toEqual(['page-1']);
        expect(screen.findByTestId('phone-sessions-retry')?.props.disabled).toBe(false);
        failPage = false;
        await act(async () => { screen.pressByTestId('phone-sessions-load-more'); });
        await flushHookEffects();
        expect(screen.findAllByType('FlatList')[0]?.props.data).toHaveLength(2);
        expect(candidatesListSpy).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'machine-1', cursor: 'fast-page' }), { serverId: 's' });
        await act(async () => { finishSlow({ ok: true, candidates: [], nextCursor: null }); });
    });

    it('invalidates an aggregate open when switching accounts before linking completes', async () => {
        activeScopeState.value = { serverId: 's', accountId: 'old' };
        routeParams.value = { serverId: 's', machineId: 'machine-1' };
        let complete!: (value: { ok: boolean; sessionId: string; created: boolean }) => void;
        linkEnsureSpy.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
        const screen = await renderScreen(<PhoneSessionsOverview />);
        await flushHookEffects();
        const original = screen.findAllByType('FlatList')[0]!.props.data[0];
        await act(async () => { screen.pressByTestId(`phone-session:${original.key}`); });
        activeScopeState.value = { serverId: 's', accountId: 'new' };
        await act(async () => { screen.tree.update(<PhoneSessionsOverview />); });
        await flushHookEffects();
        expect(screen.findAllByType('FlatList')[0]!.props.data[0].key).not.toBe(original.key);
        await act(async () => { complete({ ok: true, sessionId: 'old-account-only', created: false }); });
        expect(routerNavigateSpy).not.toHaveBeenCalled();
    });

    it('allows only one aggregate open across sources and releases the gate after failure or completion', async () => {
        await directSessionsBrowseScreenModulePromise;
        activeScopeState.value = { serverId: 's', accountId: 'a' };
        machinesState = machinesState.map((machine) => ({ ...machine, active: true }));
        candidatesListSpy.mockImplementation(async (request) => ({
            ok: true, nextCursor: null,
            candidates: request.source.kind === 'codexHome' && request.source.home === 'user' ? [phoneCandidate(request.machineId, 'running')] : [],
        }));
        let finishFirst!: (value: { ok: boolean; sessionId: string; created: boolean; error?: string }) => void;
        let finishSecond!: (value: { ok: boolean; sessionId: string; created: boolean }) => void;
        linkEnsureSpy.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
        linkEnsureSpy.mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
        const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
        const screen = await renderScreen(<PhoneSessionsOverview />);
        await flushHookEffects();
        const [first, second] = screen.findAllByType('FlatList')[0]!.props.data;
        await act(async () => {
            screen.pressByTestId(`phone-session:${first.key}`);
            screen.pressByTestId(`phone-session:${second.key}`);
        });
        expect(linkEnsureSpy).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId(`phone-session:${second.key}`)?.props.disabled).toBe(true);
        await act(async () => { finishFirst({ ok: false, sessionId: '', created: false, error: 'synthetic failure' }); });
        expect(screen.findByTestId(`phone-session:${second.key}`)?.props.disabled).toBe(false);
        await act(async () => { screen.pressByTestId(`phone-session:${second.key}`); });
        expect(linkEnsureSpy).toHaveBeenCalledTimes(2);
        await act(async () => { finishSecond({ ok: true, sessionId: 'second-open', created: false }); });
        expect(screen.findByTestId(`phone-session:${first.key}`)?.props.disabled).toBe(false);
        expect(routerNavigateSpy.mock.calls.at(-1)?.[0]).toBe('/session/second-open');
    });

    it('ignores a delayed previous-account list and does not refetch on ordinary parent rerenders', async () => {
        activeScopeState.value = { serverId: 's', accountId: 'old' };
        machinesState = [machinesState[0]!];
        let finishOld!: (value: DirectSessionsCandidatesListResponse) => void;
        candidatesListSpy.mockImplementation(async (request) => {
            if (request.source.kind !== 'codexHome' || request.source.home !== 'user') return { ok: true, candidates: [], nextCursor: null };
            if (activeScopeState.value?.accountId === 'old') return new Promise((resolve) => { finishOld = resolve; });
            return { ok: true, candidates: [phoneCandidate('new-account', 'running')], nextCursor: null };
        });
        const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
        const screen = await renderScreen(<PhoneSessionsOverview />);
        await flushHookEffects();
        activeScopeState.value = { serverId: 's', accountId: 'new' };
        await act(async () => { screen.tree.update(<PhoneSessionsOverview />); });
        await flushHookEffects();
        const requestCount = candidatesListSpy.mock.calls.length;
        await act(async () => { finishOld({ ok: true, candidates: [phoneCandidate('old-account', 'running')], nextCursor: null }); });
        for (let count = 0; count < 3; count += 1) {
            await act(async () => { screen.tree.update(<PhoneSessionsOverview />); });
            await flushHookEffects();
        }
        expect(candidatesListSpy).toHaveBeenCalledTimes(requestCount);
        expect(screen.findAllByType('FlatList')[0]?.props.data.map((row: any) => row.candidate.remoteSessionId)).toEqual(['new-account']);
    });

    it('sends expanded phone search to each existing owner and clears it when collapsed', async () => {
        vi.useFakeTimers();
        try {
            activeScopeState.value = { serverId: 's', accountId: 'a' };
            machinesState = [machinesState[0]!];
            const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
            const screen = await renderScreen(<PhoneSessionsOverview />);
            await flushHookEffects();
            await act(async () => { screen.pressByTestId('phone-sessions-search-toggle'); });
            candidatesListSpy.mockClear();
            await act(async () => { screen.changeTextByTestId('phone-sessions-search', 'selected project'); });
            await act(async () => { await vi.advanceTimersByTimeAsync(250); });
            await flushHookEffects();
            expect(candidatesListSpy.mock.calls.length).toBeGreaterThan(0);
            expect(candidatesListSpy.mock.calls.every(([request]) => request.searchTerm === 'selected project' && request.machineId === 'machine-1')).toBe(true);
            candidatesListSpy.mockClear();
            await act(async () => { screen.pressByTestId('phone-sessions-search-toggle'); });
            await flushHookEffects();
            expect(candidatesListSpy.mock.calls.length).toBeGreaterThan(0);
            expect(candidatesListSpy.mock.calls.every(([request]) => request.searchTerm === undefined)).toBe(true);
        } finally { vi.useRealTimers(); }
    });

    it('does not navigate a completed open after its account-scoped view unmounts', async () => {
        let complete!: (value: { ok: boolean; sessionId: string; created: boolean }) => void;
        linkEnsureSpy.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen lockScope={{ machineId: 'machine-1', serverId: 'old-server', providerId: 'codex', source: { kind: 'codexHome', home: 'user' } }} phonePresentation={{ searchQuery: '', includeCandidate: () => true }} />);
        await flushHookEffects();
        await act(async () => { screen.pressByTestId('direct-session-candidate:codex-session-1'); });
        await act(async () => { screen.tree.unmount(); });
        await act(async () => { complete({ ok: true, sessionId: 'old-account-session', created: false }); });
        expect(routerNavigateSpy).not.toHaveBeenCalled();
    });

    it('honors a computer-detail filter and never substitutes another server or missing machine', async () => {
        activeScopeState.value = { serverId: 's', accountId: 'a' };
        routeParams.value = { serverId: 's', machineId: 'machine-2' };
        const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
        const screen = await renderScreen(<PhoneSessionsOverview />);
        await flushHookEffects();
        expect(candidatesListSpy.mock.calls.every(([request]) => request.machineId === 'machine-2')).toBe(true);
        candidatesListSpy.mockClear();
        routeParams.value = { serverId: 'other', machineId: 'machine-2' };
        await act(async () => { screen.tree.update(<PhoneSessionsOverview />); });
        expect(screen.findByTestId('phone-sessions-unavailable')).not.toBeNull();
        expect(candidatesListSpy).not.toHaveBeenCalled();
        routeParams.value = { serverId: 's', machineId: 'absent' };
        await act(async () => { screen.tree.update(<PhoneSessionsOverview />); });
        expect(screen.findByTestId('phone-sessions-machine-unavailable')).not.toBeNull();
        expect(candidatesListSpy).not.toHaveBeenCalled();
    });

    it.each<Record<string, string>>([
        { machineId: '', serverId: 's' },
        { projectId: 'p', sourceKey: 'codex:user', serverId: 's' },
        { machineId: 'machine-1', projectId: '', sourceKey: 'codex:user', serverId: 's' },
    ])('does not broaden a malformed history route: %j', async (params) => {
        activeScopeState.value = { serverId: 's', accountId: 'a' };
        routeParams.value = params;
        const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
        const screen = await renderScreen(<PhoneSessionsOverview />);
        await flushHookEffects();
        expect(candidatesListSpy).not.toHaveBeenCalled();
        expect(screen.findAllByType('FlatList')).toHaveLength(0);
    });

    it('filters with the real selected project and keeps invalid ids from broadening the target', async () => {
        activeScopeState.value = { serverId: 's', accountId: 'a' };
        routeParams.value = { serverId: 's', machineId: 'machine-1', projectId: 'p', sourceKey: 'codex:user' };
        projectsListSpy.mockResolvedValue({ ok: true, projects: [{ id: 'p', name: 'Real project', rootPaths: ['/tmp/worktree'], available: true }], nativeCreate: false, unavailableReason: 'desktop_native_create_unavailable' } as any);
        const { PhoneSessionsOverview } = await import('./PhoneSessionsOverview');
        const screen = await renderScreen(<PhoneSessionsOverview />);
        await flushHookEffects();
        expect(screen.findAllByType('FlatList')[0]?.props.data).toHaveLength(1);
        routeParams.value = { ...routeParams.value, projectId: 'missing' };
        await act(async () => { screen.tree.update(<PhoneSessionsOverview />); });
        await flushHookEffects();
        expect(screen.findByTestId('phone-sessions-project-unavailable')).not.toBeNull();
        expect(screen.findAllByType('FlatList')[0]?.props.data ?? []).toHaveLength(0);
    });

    it('keeps pagination reachable when a phone filter excludes the entire loaded page', async () => {
        candidatesListSpy.mockResolvedValueOnce({ ok: true, candidates: [{ remoteSessionId: 'r', updatedAtMs: 1, activity: 'idle' }], nextCursor: 'next-page' });
        const { DirectSessionsBrowseScreen } = await directSessionsBrowseScreenModulePromise;
        const screen = await renderScreen(<DirectSessionsBrowseScreen lockScope={{ machineId: 'machine-1', serverId: 's', providerId: 'codex', source: { kind: 'codexHome', home: 'user' } }} phonePresentation={{ searchQuery: '', includeCandidate: () => false }} />);
        await flushHookEffects();
        expect(screen.findByTestId('direct-session-candidates-load-more')).not.toBeNull();
        await act(async () => { screen.pressByTestId('direct-session-candidates-load-more'); });
        expect(candidatesListSpy).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'next-page' }), { serverId: 's' });
    });

});
