import { describe, expect, it, vi } from 'vitest';
import { createRpcCallError } from '../runtime/rpcErrors';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';

type SessionRipgrepRpcResponse =
    | Readonly<{ success: boolean; stdout: string; stderr?: string; exitCode?: number }>
    | null;

const sessionRPCSpy = vi.fn(
    async (_sessionId: string, _method: string, _payload: unknown): Promise<SessionRipgrepRpcResponse> => ({
        success: true,
        stdout: 'src/a.ts\n',
        stderr: '',
        exitCode: 0,
    }),
);
const machineRPCSpy = vi.fn(
    async (_machineId: string, _method: string, _payload: unknown): Promise<SessionRipgrepRpcResponse> => ({
        success: true,
        stdout: 'src/a.ts\n',
        stderr: '',
        exitCode: 0,
    }),
);
const getStateSpy = vi.fn();
const sessionRpcWithPreferredSessionScopeSpy = vi.fn(
    async (params: unknown): Promise<SessionRipgrepRpcResponse> => {
        const { sessionId, method, payload } = params as { sessionId: string; method: string; payload: unknown };
        return sessionRPCSpy(sessionId, method, payload);
    },
);

vi.mock('../api/session/apiSocket', () => ({
    apiSocket: {
        sessionRPC: (sessionId: string, method: string, payload: any) => sessionRPCSpy(sessionId, method, payload),
        machineRPC: (machineId: string, method: string, payload: any) => machineRPCSpy(machineId, method, payload),
    },
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope', () => ({
    sessionRpcWithPreferredSessionScope: (params: unknown) => sessionRpcWithPreferredSessionScopeSpy(params),
}));

vi.mock('@/sync/domains/state/storage', () => ({
    storage: {
        getState: () => getStateSpy(),
    },
}));

describe('sessionRipgrep', () => {
    it('prefers machine RPC and resolves cwd against session cwd', async () => {
        const { sessionRipgrep } = await import('./sessions');

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
                    activeAt: 1,
                    metadata: { host: 'm1.local' },
                },
            },
        });

        sessionRPCSpy.mockClear();
        sessionRpcWithPreferredSessionScopeSpy.mockClear();
        machineRPCSpy.mockClear();

        const res = await sessionRipgrep('s1', ['--files'], 'src');
        expect(res.success).toBe(true);
        expect(machineRPCSpy).toHaveBeenCalledWith('m1', 'ripgrep', {
            args: ['--files'],
            cwd: '~/repo/src',
        });
        expect(sessionRPCSpy).not.toHaveBeenCalled();
    });

    it('does not fall back to session RPC for inactive sessions', async () => {
        const { sessionRipgrep } = await import('./sessions');

        getStateSpy.mockReturnValue({
            sessions: {
                s1: {
                    active: false,
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
                    activeAt: 1,
                    metadata: { host: 'm1.local' },
                },
            },
        });

        machineRPCSpy.mockRejectedValueOnce(
            createRpcCallError({ error: 'Method not found', errorCode: RPC_ERROR_CODES.METHOD_NOT_FOUND }),
        );
        sessionRPCSpy.mockResolvedValueOnce({
            success: true,
            stdout: 'src/a.ts\n',
            stderr: '',
            exitCode: 0,
        });

        const res = await sessionRipgrep('s1', ['--files'], undefined);
        expect(res.success).toBe(false);
        expect(sessionRPCSpy).not.toHaveBeenCalled();
        expect(sessionRpcWithPreferredSessionScopeSpy).not.toHaveBeenCalled();
    });

    it('fails closed when inactive session has no machine target', async () => {
        const { sessionRipgrep } = await import('./sessions');

        getStateSpy.mockReturnValue({
            sessions: {
                s1: {
                    active: false,
                    metadata: {
                        path: '',
                        machineId: '',
                    },
                },
            },
            machines: {},
            getProjectForSession: () => null,
        });

        sessionRPCSpy.mockResolvedValueOnce({
            success: true,
            stdout: 'src/a.ts\n',
            stderr: '',
            exitCode: 0,
        });
        machineRPCSpy.mockClear();

        const res = await sessionRipgrep('s1', ['--files']);
        expect(res.success).toBe(false);
        expect(machineRPCSpy).not.toHaveBeenCalled();
        expect(sessionRPCSpy).not.toHaveBeenCalled();
    });
});
