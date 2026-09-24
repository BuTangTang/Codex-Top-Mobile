import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import {
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';

import {
    cloneNavigationState,
    createNavigationMock,
    createRouterMock,
    enableReactActEnvironment,
    installPickerCommonModuleMocks,
    type PickerNavigationState,
} from './testHarness';

type PathSelectionListProps = {
    favorites: ReadonlyArray<{ path: string; label?: string }>;
    machineId: string | null;
    serverId: string | null;
    machineHomeDir: string;
    initialValue: string;
    onCommit: (path: string) => void;
};

let lastPathSelectorProps: PathSelectionListProps | null = null;
const routerMock = createRouterMock();
const navigationMock = createNavigationMock();
let navigationState: PickerNavigationState = cloneNavigationState({
    index: 1,
    routes: [{ key: 'a' }, { key: 'b' }],
});
let localSearchParams: {
    dataId?: string;
    machineId?: string;
    selectedPath?: string;
    spawnServerId?: string;
} = { machineId: 'm1', selectedPath: '/tmp' };

enableReactActEnvironment();

const pickerMachineMetadata = {
    host: 'tester.local',
    platform: 'darwin',
    happyCliVersion: '0.0.0-test',
    happyHomeDir: '/Users/tester/.happy-dev',
    homeDir: '/home',
} as const;
const pickerMachine = createMachineFixture({
    id: 'm1',
    metadata: pickerMachineMetadata,
});
installPickerCommonModuleMocks({
    text: async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock(),
    reactNative: async () =>
        (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: (options: { web?: unknown; ios?: unknown; default?: unknown }) =>
                    options.web ?? options.ios ?? options.default,
            },
            TurboModuleRegistry: {
                getEnforcing: () => ({}),
            },
        }),
    expoRouter: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const module = createExpoRouterMock({
            navigation: navigationMock,
            router: {
                push: routerMock.push,
                back: routerMock.back,
                replace: routerMock.replace,
                setParams: routerMock.setParams,
            },
        }).module;

        return {
            ...module,
            useNavigation: () => navigationMock,
            useLocalSearchParams: () => localSearchParams,
        };
    },
    unistyles: async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock(),
    storage: async (importOriginal) =>
        (await import('@/dev/testkit/mocks/storage')).createStorageModuleMock({
            importOriginal,
            overrides: {
                useAllMachines: () => [pickerMachine],
                useSessions: () => [],
                useSetting: (key: string) => {
                    if (key === 'recentMachinePaths') return [];
                    if (key === 'usePathPickerSearch') return false;
                    return null;
                },
                useSettingMutable: (key: string) => {
                    if (key === 'favoriteDirectories') return [undefined, vi.fn()];
                    return [null, vi.fn()];
                },
            },
        }),
});

vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: React.PropsWithChildren<Record<string, never>>) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 900 },
}));

vi.mock('@/components/ui/forms/SearchHeader', () => ({
    SearchHeader: () => null,
}));

vi.mock('@/components/sessions/new/components/PathSelectionList', () => ({
    PathSelectionList: (props: PathSelectionListProps) => {
        lastPathSelectorProps = props;
        return null;
    },
}));

describe('PathPickerScreen', () => {
    afterEach(() => {
        standardCleanup();
    });

    beforeEach(() => {
        lastPathSelectorProps = null;
        localSearchParams = { machineId: 'm1', selectedPath: '/tmp' };
        navigationState = {
            index: 2,
            routes: [
                { key: 'session-route' },
                { key: 'new-route', name: '(app)/new/index', path: '/new', params: { machineId: 'm1' } },
                { key: 'path-picker', name: '(app)/new/pick/path', path: '/new/pick/path' },
            ],
        };
        navigationMock.getState = () => navigationState;
        routerMock.back.mockClear();
        routerMock.replace.mockClear();
        routerMock.setParams.mockClear();
        navigationMock.dispatch.mockClear();
        navigationMock.goBack.mockClear();
    });

    async function renderPathPicker() {
        const PathPickerScreen = (await import('@/app/(app)/new/pick/path')).default;
        return renderScreen(React.createElement(PathPickerScreen));
    }

    it('defaults the favorite list to empty when the setting is undefined', async () => {
        await renderPathPicker();

        expect(lastPathSelectorProps).toBeTruthy();
        expect(lastPathSelectorProps?.favorites).toEqual([]);
    });

    it('passes the machine id and home dir to PathSelectionList for the current machine', async () => {
        await renderPathPicker();

        expect(lastPathSelectorProps?.machineId).toBe('m1');
        expect(lastPathSelectorProps?.machineHomeDir).toBe('/home');
    });

    it('sets the selected path on the previous route params when confirming', async () => {
        await renderPathPicker();

        expect(lastPathSelectorProps).toBeTruthy();
        act(() => {
            lastPathSelectorProps?.onCommit('/Users/leeroy/Documents/Development/happier/dev/apps/stack');
        });

        expect(navigationMock.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'SET_PARAMS',
            source: 'new-route',
            payload: expect.objectContaining({
                params: expect.objectContaining({
                    directory: '/Users/leeroy/Documents/Development/happier/dev/apps/stack',
                }),
            }),
        }));
        expect(navigationMock.goBack).toHaveBeenCalled();
        expect(routerMock.back).not.toHaveBeenCalled();
    });

    it('falls back to router params update when there is no previous route', async () => {
        navigationState = { index: 0, routes: [{ key: 'only' }] };
        localSearchParams = {
            dataId: 'draft-1',
            machineId: 'm1',
            selectedPath: '/tmp',
            spawnServerId: 'server-b',
        };
        await renderPathPicker();

        expect(lastPathSelectorProps).toBeTruthy();
        act(() => {
            lastPathSelectorProps?.onCommit('');
        });

        expect(navigationMock.dispatch).not.toHaveBeenCalled();
        expect(routerMock.back).not.toHaveBeenCalled();
        expect(routerMock.setParams).not.toHaveBeenCalled();
        expect(routerMock.replace).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                dataId: 'draft-1',
                machineId: 'm1',
                directory: '/home',
                spawnServerId: 'server-b',
            },
        });
    });
});
