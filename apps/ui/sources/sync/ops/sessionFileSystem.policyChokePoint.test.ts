import { describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { FeaturesResponse } from '@happier-dev/protocol';

type GetDirectoryTreeRpcResponse =
    | Readonly<{ success: true; tree: unknown }>
    | Readonly<{ success: false; error: string; errorCode?: string }>
    | null;

let enforcePolicyConsultedBeforeMachineRpc = false;
let policyConsulted = false;

const machineRPCSpy = vi.fn(
    async (_machineId: string, _method: string, _payload: unknown) => {
        if (enforcePolicyConsultedBeforeMachineRpc) {
            expect(policyConsulted).toBe(true);
        }
        return { success: true } as const;
    },
);

const sessionRpcWithServerScopeSpy = vi.fn(
    async (_params: unknown) => ({ success: true } as const),
);

const machineRpcWithServerScopeSpy = vi.fn(
    async (_params: unknown) => ({ success: true } as const),
);

const getReadyServerFeaturesSpy = vi.fn(async (_params: unknown): Promise<FeaturesResponse | null> => {
    policyConsulted = true;
    return {
        features: {
            machines: {
                enabled: true,
                transfer: {
                    enabled: true,
                    serverRouted: {
                        enabled: true,
                    },
                },
            },
        },
        capabilities: {},
    } as FeaturesResponse;
});

const getStateSpy = vi.fn();

vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: {
        machineRPC: (machineId: string, method: string, payload: unknown) =>
            machineRPCSpy(machineId, method, payload),
    },
}));

vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getReadyServerFeatures: (params: unknown) => getReadyServerFeaturesSpy(params),
    getCachedReadyServerFeatures: (_params: unknown) => null,
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', () => ({
    sessionRpcWithServerScope: (params: unknown) => sessionRpcWithServerScopeSpy(params),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (params: unknown) => machineRpcWithServerScopeSpy(params),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId', () => ({
    resolvePreferredServerIdForSessionId: () => 'server-1',
}));

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    const readSnapshot = () => getStateSpy();
    const storage = Object.assign(
        ((selector?: (value: ReturnType<typeof readSnapshot>) => unknown) => {
            const snapshot = readSnapshot();
            return typeof selector === 'function' ? selector(snapshot) : snapshot;
        }),
        {
            getState: readSnapshot,
            getInitialState: readSnapshot,
            setState: () => undefined,
            subscribe: () => () => undefined,
            destroy: () => undefined,
        },
    );
    return createStorageModuleStub({ storage });
});

function resetPolicyFlags() {
    enforcePolicyConsultedBeforeMachineRpc = false;
    policyConsulted = false;
}

function setActiveSessionMachineState() {
    getStateSpy.mockReturnValue({
        sessions: {
            s1: {
                active: true,
                metadata: {
                    path: '~/repo',
                    machineId: 'm1',
                },
            },
        },
        machines: {
            m1: {
                id: 'm1',
                active: true,
                metadata: {},
            },
        },
    });
}

describe('sessionFileSystem policy choke point', () => {
    it('fails closed (no machine_rpc_direct) for guarded methods when server features are not available yet', async () => {
        const { sessionRenamePath } = await import('./sessionFileSystem');

        resetPolicyFlags();
        enforcePolicyConsultedBeforeMachineRpc = true;

        setActiveSessionMachineState();

        machineRPCSpy.mockClear();
        sessionRpcWithServerScopeSpy.mockClear();
        machineRpcWithServerScopeSpy.mockClear();
        getReadyServerFeaturesSpy.mockClear();
        getReadyServerFeaturesSpy.mockImplementationOnce(async (): Promise<FeaturesResponse | null> => {
            policyConsulted = true;
            return null;
        });

        const res = await sessionRenamePath('s1', { from: 'README.md', to: 'README2.md' });
        expect(res).toEqual({ success: true });
        expect(getReadyServerFeaturesSpy).toHaveBeenCalledTimes(1);
        expect(machineRPCSpy).not.toHaveBeenCalled();
        expect(machineRpcWithServerScopeSpy).toHaveBeenCalledTimes(1);
        expect(sessionRpcWithServerScopeSpy).not.toHaveBeenCalled();
    });

    it('fails closed (no machine_rpc_direct) for guarded methods when server features evaluation throws', async () => {
        const { sessionRenamePath } = await import('./sessionFileSystem');

        resetPolicyFlags();
        enforcePolicyConsultedBeforeMachineRpc = true;

        setActiveSessionMachineState();

        machineRPCSpy.mockClear();
        sessionRpcWithServerScopeSpy.mockClear();
        machineRpcWithServerScopeSpy.mockClear();
        getReadyServerFeaturesSpy.mockClear();
        getReadyServerFeaturesSpy.mockImplementationOnce(async (): Promise<FeaturesResponse | null> => {
            policyConsulted = true;
            throw new Error('failed to load features');
        });

        const res = await sessionRenamePath('s1', { from: 'README.md', to: 'README2.md' });
        expect(res).toEqual({ success: true });
        expect(getReadyServerFeaturesSpy).toHaveBeenCalledTimes(1);
        expect(machineRPCSpy).not.toHaveBeenCalled();
        expect(machineRpcWithServerScopeSpy).toHaveBeenCalledTimes(1);
        expect(sessionRpcWithServerScopeSpy).not.toHaveBeenCalled();
    });

    it('sessionRenamePath consults shared transfer policy before direct machine rpc', async () => {
        const { sessionRenamePath } = await import('./sessionFileSystem');

        resetPolicyFlags();
        enforcePolicyConsultedBeforeMachineRpc = true;

        setActiveSessionMachineState();

        machineRPCSpy.mockClear();
        sessionRpcWithServerScopeSpy.mockClear();
        getReadyServerFeaturesSpy.mockClear();

        const res = await sessionRenamePath('s1', { from: 'README.md', to: 'README2.md' });
        expect(res).toEqual({ success: true });
        expect(getReadyServerFeaturesSpy).toHaveBeenCalledTimes(1);
        expect(machineRPCSpy).toHaveBeenCalledWith('m1', RPC_METHODS.RENAME_PATH, {
            from: '~/repo/README.md',
            to: '~/repo/README2.md',
            overwrite: undefined,
        });
        expect(sessionRpcWithServerScopeSpy).not.toHaveBeenCalled();
    });

    it('sessionDeletePath consults shared transfer policy before direct machine rpc', async () => {
        const { sessionDeletePath } = await import('./sessionFileSystem');

        resetPolicyFlags();
        enforcePolicyConsultedBeforeMachineRpc = true;

        setActiveSessionMachineState();

        machineRPCSpy.mockClear();
        sessionRpcWithServerScopeSpy.mockClear();
        getReadyServerFeaturesSpy.mockClear();

        const res = await sessionDeletePath('s1', { path: 'tmp/a.txt', recursive: true });
        expect(res).toEqual({ success: true });
        expect(getReadyServerFeaturesSpy).toHaveBeenCalledTimes(1);
        expect(machineRPCSpy).toHaveBeenCalledWith('m1', RPC_METHODS.DELETE_PATH, {
            path: '~/repo/tmp/a.txt',
            recursive: true,
        });
        expect(sessionRpcWithServerScopeSpy).not.toHaveBeenCalled();
    });

    it('sessionGetDirectoryTree consults shared transfer policy before direct machine rpc', async () => {
        const { sessionGetDirectoryTree } = await import('./sessionFileSystem');

        resetPolicyFlags();
        enforcePolicyConsultedBeforeMachineRpc = true;

        setActiveSessionMachineState();

        machineRPCSpy.mockClear();
        sessionRpcWithServerScopeSpy.mockClear();
        getReadyServerFeaturesSpy.mockClear();

        const response: GetDirectoryTreeRpcResponse = {
            success: true,
            tree: { name: 'repo', children: [] },
        };
        machineRPCSpy.mockResolvedValueOnce(response);

        const res = await sessionGetDirectoryTree('s1', 'src', 3);
        expect(res).toEqual(response);
        expect(getReadyServerFeaturesSpy).toHaveBeenCalledTimes(1);
        expect(machineRPCSpy).toHaveBeenCalledWith('m1', RPC_METHODS.GET_DIRECTORY_TREE, {
            path: '~/repo/src',
            maxDepth: 3,
        });
        expect(sessionRpcWithServerScopeSpy).not.toHaveBeenCalled();
    });

    it('sessionCreateDirectory consults shared transfer policy before direct machine rpc', async () => {
        const { sessionCreateDirectory } = await import('./sessionFileSystem');

        resetPolicyFlags();
        enforcePolicyConsultedBeforeMachineRpc = true;

        setActiveSessionMachineState();

        machineRPCSpy.mockClear();
        sessionRpcWithServerScopeSpy.mockClear();
        getReadyServerFeaturesSpy.mockClear();

        const res = await sessionCreateDirectory('s1', 'tmp/new-dir');
        expect(res).toEqual({ success: true });
        expect(getReadyServerFeaturesSpy).toHaveBeenCalledTimes(1);
        expect(machineRPCSpy).toHaveBeenCalledWith('m1', RPC_METHODS.CREATE_DIRECTORY, {
            path: '~/repo/tmp/new-dir',
        });
        expect(sessionRpcWithServerScopeSpy).not.toHaveBeenCalled();
    });

    it('sessionListDirectory consults shared transfer policy before direct machine rpc', async () => {
        const { sessionListDirectory } = await import('./sessionFileSystem');

        resetPolicyFlags();
        enforcePolicyConsultedBeforeMachineRpc = true;

        setActiveSessionMachineState();

        machineRPCSpy.mockClear();
        sessionRpcWithServerScopeSpy.mockClear();
        getReadyServerFeaturesSpy.mockClear();

        const response = {
            success: true,
            entries: [],
        } as const;
        machineRPCSpy.mockResolvedValueOnce(response);

        const res = await sessionListDirectory('s1', 'src');
        expect(res).toEqual(response);
        expect(getReadyServerFeaturesSpy).toHaveBeenCalledTimes(1);
        expect(machineRPCSpy).toHaveBeenCalledWith('m1', RPC_METHODS.LIST_DIRECTORY, {
            path: '~/repo/src',
        });
        expect(sessionRpcWithServerScopeSpy).not.toHaveBeenCalled();
    });

    it('sessionStatFile consults shared transfer policy before direct machine rpc', async () => {
        const { sessionStatFile } = await import('./sessionFileSystem');

        resetPolicyFlags();
        enforcePolicyConsultedBeforeMachineRpc = true;

        setActiveSessionMachineState();

        machineRPCSpy.mockClear();
        sessionRpcWithServerScopeSpy.mockClear();
        getReadyServerFeaturesSpy.mockClear();

        const response = {
            success: true,
            exists: true,
            kind: 'file',
            sizeBytes: 123,
            modifiedMs: 456,
        } as const;
        machineRPCSpy.mockResolvedValueOnce(response);

        const res = await sessionStatFile('s1', 'package.json');
        expect(res).toEqual(response);
        expect(getReadyServerFeaturesSpy).toHaveBeenCalledTimes(1);
        expect(machineRPCSpy).toHaveBeenCalledWith('m1', RPC_METHODS.STAT_FILE, {
            path: '~/repo/package.json',
        });
        expect(sessionRpcWithServerScopeSpy).not.toHaveBeenCalled();
    });
});
