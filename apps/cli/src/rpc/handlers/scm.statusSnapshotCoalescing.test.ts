import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RpcHandler, RpcHandlerRegistrar } from '@/api/rpc/types';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const { runScmProvisioningRouteMock, runScmRouteMock } = vi.hoisted(() => ({
  runScmProvisioningRouteMock: vi.fn(),
  runScmRouteMock: vi.fn(),
}));

vi.mock('@/scm/rpc/dispatch', () => ({
  createNonRepositoryScmSnapshotResponse: vi.fn(),
  notRepositoryResponse: vi.fn(),
  runScmProvisioningRoute: (...args: unknown[]) => runScmProvisioningRouteMock(...args),
  runScmRoute: (...args: unknown[]) => runScmRouteMock(...args),
}));

describe('registerScmHandlers status snapshot coalescing', () => {
  afterEach(() => {
    vi.resetModules();
    runScmProvisioningRouteMock.mockReset();
    runScmRouteMock.mockReset();
  });

  const registerHandlers = async (): Promise<Map<string, RpcHandler>> => {
    const handlers = new Map<string, RpcHandler>();
    const registrar: RpcHandlerRegistrar = {
      registerHandler(method, handler) {
        handlers.set(method, handler);
      },
    };
    const { registerScmHandlers } = await import('./scm');
    registerScmHandlers(registrar, '/workspace');
    return handlers;
  };

  const expectStaleInFlightStatusToBeSuppressedAfterMutation = async (
    mutationMethod: string,
    mutationRequest: Record<string, unknown>,
    expectedRunCounts: Readonly<{
      route: number;
      provisioning: number;
    }>,
  ): Promise<void> => {
    const handlers = await registerHandlers();
    const statusHandler = handlers.get(RPC_METHODS.SCM_STATUS_SNAPSHOT);
    const mutationHandler = handlers.get(mutationMethod);
    expect(statusHandler).toBeTypeOf('function');
    expect(mutationHandler).toBeTypeOf('function');
    if (!statusHandler || !mutationHandler) throw new Error('SCM handlers were not registered');

    const staleResponse = { success: true, snapshot: { id: 'stale' } };
    const freshResponse = { success: true, snapshot: { id: 'fresh' } };
    const staleStatusResolvers: Array<(response: unknown) => void> = [];

    runScmRouteMock.mockImplementation(({ request }: { request?: Record<string, unknown> }) => {
      if (request?.includeWorktreeStatus === true) {
        return new Promise((resolve) => {
          staleStatusResolvers.push(resolve);
        });
      }
      return Promise.resolve({ success: true });
    });
    runScmProvisioningRouteMock.mockResolvedValue({ success: true });

    const staleStatus = statusHandler({ cwd: '.', includeWorktreeStatus: true });
    await mutationHandler(mutationRequest);
    expect(runScmRouteMock).toHaveBeenCalledTimes(expectedRunCounts.route);
    expect(runScmProvisioningRouteMock).toHaveBeenCalledTimes(expectedRunCounts.provisioning);

    const resolveStaleStatus = staleStatusResolvers.at(0);
    if (!resolveStaleStatus) {
      throw new Error('Expected first status snapshot to be pending');
    }
    resolveStaleStatus(staleResponse);
    await expect(staleStatus).resolves.toBe(staleResponse);

    runScmRouteMock.mockReset();
    runScmProvisioningRouteMock.mockReset();
    runScmRouteMock.mockResolvedValueOnce(freshResponse);
    await expect(statusHandler({ cwd: '.', includeWorktreeStatus: true })).resolves.toBe(freshResponse);
    expect(runScmRouteMock).toHaveBeenCalledTimes(1);
    expect(runScmProvisioningRouteMock).not.toHaveBeenCalled();
  };

  it('shares one in-flight status snapshot for identical requests and reuses the fresh cached result', async () => {
    const handlers = await registerHandlers();
    const handler = handlers.get(RPC_METHODS.SCM_STATUS_SNAPSHOT);
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('SCM status handler was not registered');

    const firstResponse = { success: true, snapshot: { id: 'first' } };
    const pendingResolvers: Array<(response: unknown) => void> = [];
    runScmRouteMock.mockImplementation(
      () => new Promise((resolve) => {
        pendingResolvers.push(resolve);
      }),
    );

    const first = handler({ cwd: '.', includeWorktreeStatus: true });
    const second = handler({ cwd: '.', includeWorktreeStatus: true });
    try {
      expect(runScmRouteMock).toHaveBeenCalledTimes(1);
    } finally {
      for (const resolve of pendingResolvers) {
        resolve(firstResponse);
      }
    }
    await expect(Promise.all([first, second])).resolves.toEqual([firstResponse, firstResponse]);

    const secondResponse = { success: true, snapshot: { id: 'second' } };
    runScmRouteMock.mockReset();
    runScmRouteMock.mockResolvedValueOnce(secondResponse);
    await expect(handler({ cwd: '.', includeWorktreeStatus: true })).resolves.toBe(firstResponse);
    expect(runScmRouteMock).not.toHaveBeenCalled();
  });

  it('does not reuse stale in-flight status snapshots after mutating RPCs', async () => {
    const handlers = await registerHandlers();
    const statusHandler = handlers.get(RPC_METHODS.SCM_STATUS_SNAPSHOT);
    const discardHandler = handlers.get(RPC_METHODS.SCM_CHANGE_DISCARD);
    expect(statusHandler).toBeTypeOf('function');
    expect(discardHandler).toBeTypeOf('function');
    if (!statusHandler || !discardHandler) throw new Error('SCM handlers were not registered');

    const staleResponse = { success: true, snapshot: { id: 'stale' } };
    const freshResponse = { success: true, snapshot: { id: 'fresh' } };
    const staleStatusResolvers: Array<(response: unknown) => void> = [];

    runScmRouteMock.mockImplementation(({ request }: { request?: Record<string, unknown> }) => {
      if (request?.includeWorktreeStatus === true) {
        return new Promise((resolve) => {
          staleStatusResolvers.push(resolve);
        });
      }
      return Promise.resolve({ success: true });
    });

    const staleStatus = statusHandler({ cwd: '.', includeWorktreeStatus: true });
    await discardHandler({ cwd: '.', changes: [{ path: 'file.txt' }] });
    expect(runScmRouteMock).toHaveBeenCalledTimes(2);

    const resolveStaleStatus = staleStatusResolvers.at(0);
    if (!resolveStaleStatus) {
      throw new Error('Expected first status snapshot to be pending');
    }
    resolveStaleStatus(staleResponse);
    await expect(staleStatus).resolves.toBe(staleResponse);

    runScmRouteMock.mockReset();
    runScmRouteMock.mockResolvedValueOnce(freshResponse);
    await expect(statusHandler({ cwd: '.', includeWorktreeStatus: true })).resolves.toBe(freshResponse);
    expect(runScmRouteMock).toHaveBeenCalledTimes(1);
  });

  it('does not reuse stale in-flight status snapshots after split pull-request mutations', async () => {
    await expectStaleInFlightStatusToBeSuppressedAfterMutation(
      RPC_METHODS.SCM_PULL_REQUEST_OPEN_OR_REUSE,
      { cwd: '.', title: 'Fix cache invalidation' },
      { route: 2, provisioning: 0 },
    );
  });

  it('does not reuse stale in-flight status snapshots after split repository provisioning mutations', async () => {
    await expectStaleInFlightStatusToBeSuppressedAfterMutation(
      RPC_METHODS.SCM_REPOSITORY_INIT,
      { cwd: '.' },
      { route: 1, provisioning: 1 },
    );
  });
});
