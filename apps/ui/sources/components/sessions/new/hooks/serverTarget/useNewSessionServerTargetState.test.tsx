import * as React from 'react';

import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    useNewSessionServerTargetState,
    type NewSessionServerTargetSettings,
} from '@/components/sessions/new/hooks/serverTarget/useNewSessionServerTargetState';
import { renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const serverProfilesState = vi.hoisted(() => ({
    calls: 0,
    value: [
        { id: 'server-a', name: 'Server A', serverUrl: 'https://a.example.test', lastUsedAt: 1000 },
        { id: 'server-c', name: 'Server C', serverUrl: 'https://c.example.test', lastUsedAt: 800 },
        { id: 'server-b', name: 'Server B', serverUrl: 'https://b.example.test', lastUsedAt: 900 },
    ],
}));

const defaultServerProfiles = [
    { id: 'server-a', name: 'Server A', serverUrl: 'https://a.example.test', lastUsedAt: 1000 },
    { id: 'server-c', name: 'Server C', serverUrl: 'https://c.example.test', lastUsedAt: 800 },
    { id: 'server-b', name: 'Server B', serverUrl: 'https://b.example.test', lastUsedAt: 900 },
];

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    return {
        ...actual,
        listServerProfiles: () => {
        serverProfilesState.calls += 1;
        return serverProfilesState.value;
        },
    };
});

type ProbeProps = Readonly<{
    activeServerSnapshot?: Readonly<{
        serverId: string;
        serverUrl: string;
        generation: number;
    }>;
    settings?: NewSessionServerTargetSettings;
    request: Readonly<{
        spawnServerIdParam?: string | null;
    }>;
    onState: (value: ReturnType<typeof useNewSessionServerTargetState>) => void;
}>;

function Probe(props: ProbeProps) {
    const state = useNewSessionServerTargetState({
        settings: props.settings ?? {
            serverSelectionGroups: [
                { id: 'grp-dev', name: 'Dev', serverIds: ['server-b', 'server-c'], presentation: 'grouped' },
            ],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp-dev',
        },
        activeServerSnapshot: props.activeServerSnapshot ?? {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        },
        request: props.request,
    });
    React.useEffect(() => {
        props.onState(state);
    }, [props, state]);
    return null;
}

describe('useNewSessionServerTargetState', () => {
    beforeEach(() => {
        serverProfilesState.calls = 0;
        serverProfilesState.value = defaultServerProfiles.slice();
    });

    it('preserves listServerProfiles ordering (does not reorder by lastUsedAt)', async () => {
        const captured: Array<ReturnType<typeof useNewSessionServerTargetState>> = [];

        await renderScreen(<Probe
                    request={{}}
                    onState={(state) => captured.push(state)}
                />);

        expect(captured.at(-1)!.serverProfiles.map((profile) => profile.id)).toEqual(['server-a', 'server-c', 'server-b']);
    });

    it('does not reload server profiles when only active server generation changes', async () => {
        const captured: Array<ReturnType<typeof useNewSessionServerTargetState>> = [];
        const firstActiveServerSnapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        };

        const screen = await renderScreen(<Probe
                    activeServerSnapshot={firstActiveServerSnapshot}
                    request={{}}
                    onState={(state) => captured.push(state)}
                />);
        expect(serverProfilesState.calls).toBe(1);

        await act(async () => {
            screen.tree.update(<Probe
                        activeServerSnapshot={{
                            ...firstActiveServerSnapshot,
                            generation: 2,
                        }}
                        request={{}}
                        onState={(state) => captured.push(state)}
                    />);
        });

        expect(serverProfilesState.calls).toBe(1);
        expect(captured.at(-1)!.serverProfiles).toBe(captured.at(0)!.serverProfiles);
    });

    it('derives allowed server ids from the current active settings target and resolves requested server inside that scope', async () => {
        const captured: Array<ReturnType<typeof useNewSessionServerTargetState>> = [];

        await renderScreen(<Probe
                    request={{
                        spawnServerIdParam: 'server-c',
                    }}
                    onState={(state) => captured.push(state)}
                />);

        const latest = captured.at(-1)!;
        expect(latest.selectedServerTarget?.kind).toBe('group');
        expect(latest.allowedTargetServerIds).toEqual(['server-b', 'server-c']);
        expect(latest.targetServerId).toBe('server-c');
        expect(latest.targetServerName).toBe('Server C');
        expect(latest.showServerPickerChip).toBe(true);
    });

    it('falls back to the first allowed group server when requested server is outside current active target scope', async () => {
        const captured: Array<ReturnType<typeof useNewSessionServerTargetState>> = [];

        await renderScreen(<Probe
                    request={{
                        spawnServerIdParam: 'server-a',
                    }}
                    onState={(state) => captured.push(state)}
                />);

        const latest = captured.at(-1)!;
        expect(latest.allowedTargetServerIds).toEqual(['server-b', 'server-c']);
        expect(latest.targetServerId).toBe('server-b');
        expect(latest.targetServerName).toBe('Server B');
        expect(latest.showServerPickerChip).toBe(true);
    });

    it('targets identity-backed server ids while resolving the profile by its stable profile record', async () => {
        serverProfilesState.value = [
            { id: 'localhost-18829', serverIdentityId: 'srv_identity_a', name: 'Server A', serverUrl: 'https://a.example.test', lastUsedAt: 1000 },
            { id: 'server-c', name: 'Server C', serverUrl: 'https://c.example.test', lastUsedAt: 800 },
        ] as any;
        const captured: Array<ReturnType<typeof useNewSessionServerTargetState>> = [];

        await renderScreen(<Probe
                    activeServerSnapshot={{
                        serverId: 'srv_identity_a',
                        serverUrl: 'https://a.example.test',
                        generation: 1,
                    }}
                    settings={{
                        serverSelectionGroups: [],
                        serverSelectionActiveTargetKind: 'server',
                        serverSelectionActiveTargetId: 'localhost-18829',
                    }}
                    request={{}}
                    onState={(state) => captured.push(state)}
                />);

        const latest = captured.at(-1)!;
        expect(latest.resolvedSettingsTarget.activeServerId).toBe('srv_identity_a');
        expect(latest.targetServerId).toBe('srv_identity_a');
        expect(latest.targetServerProfile?.id).toBe('localhost-18829');
        expect(latest.targetServerName).toBe('Server A');
    });
});
