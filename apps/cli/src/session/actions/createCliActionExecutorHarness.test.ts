import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalRequestV1, ActionExecutorDeps } from '@happier-dev/protocol';
import { createEnvKeyScope } from '@/testkit/env/envScope';

import { createCliActionExecutorHarness } from './createCliActionExecutorHarness';

function createApprovalRequest(overrides: Partial<ApprovalRequestV1> = {}): ApprovalRequestV1 {
  return {
    v: 1,
    status: 'open',
    createdAtMs: 1,
    updatedAtMs: 1,
    createdBy: { surface: 'session_agent', sessionId: 'sess_1' },
    requestedSurface: 'session_agent',
    actionId: 'session.list',
    actionArgs: { limit: 10 },
    summary: 'Approve listing sessions',
    preview: { actionId: 'session.list', actionArgs: { limit: 10 } },
    ...overrides,
  } as ApprovalRequestV1;
}

async function expectSettled<T>(promise: Promise<T>): Promise<T | 'pending'> {
  await Promise.resolve();
  return await Promise.race([
    promise,
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0)),
  ]);
}

describe('createCliActionExecutorHarness', () => {
  const envScope = createEnvKeyScope(['HAPPIER_ACTIONS_SETTINGS_V1', 'HAPPIER_BLOCKING_APPROVAL_POLL_INTERVAL_MS']);

  beforeEach(() => {
    envScope.restore();
  });

  it('lets callers override action approval policy for a specific runtime surface', async () => {
    const approvalsCreate = vi.fn(async () => ({ artifactId: 'approval_1' }));
    const sessionTitleSet = vi.fn(async () => ({ ok: true, sessionId: 'sess_1', title: 'Updated' }));
    const harness = createCliActionExecutorHarness(
      {
        token: 'token',
        sessionId: 'sess_1',
        ctx: {
          encryptionKey: new Uint8Array(32).fill(1),
          encryptionVariant: 'legacy',
        },
      },
      {
        approvalsCreate,
        sessionTitleSet,
        isActionEnabled: () => true,
        isActionApprovalRequired: (id, ctx) => id === 'session.title.set' && ctx.surface === 'session_agent',
      },
    );

    const result = await harness.executor.execute(
      'session.title.set',
      { sessionId: 'sess_1', title: 'Updated' },
      { surface: 'session_agent', defaultSessionId: 'sess_1' },
    );

    expect(result).toMatchObject({
      ok: true,
      result: {
        kind: 'approval_request_created',
        artifactId: 'approval_1',
        actionId: 'session.title.set',
      },
    });
    expect(approvalsCreate).toHaveBeenCalledTimes(1);
    expect(sessionTitleSet).not.toHaveBeenCalled();
  });

  it('wires blocking approval waiters to rejection artifact updates', async () => {
    const approvalsUpdate = vi.fn(async () => ({ ok: true as const }));
    const harness = createCliActionExecutorHarness(
      {
        token: 'token',
        sessionId: 'sess_1',
        ctx: {
          encryptionKey: new Uint8Array(32).fill(1),
          encryptionVariant: 'legacy',
        },
      },
      {
        approvalsUpdate,
      },
    );

    const waitForDecision = harness.deps.approvalsWaitForDecision;
    expect(waitForDecision).toBeDefined();
    if (!waitForDecision) throw new Error('expected approvalsWaitForDecision');

    const pending = waitForDecision({
      artifactId: 'approval_1',
      request: createApprovalRequest(),
    });

    await harness.deps.approvalsUpdate?.({
      artifactId: 'approval_1',
      request: createApprovalRequest({
        status: 'rejected',
        decision: { kind: 'reject', decidedAtMs: 2 },
      }),
      serverId: null,
    });

    await expect(pending).resolves.toMatchObject({ decision: 'reject' });
    expect(approvalsUpdate).toHaveBeenCalledTimes(1);
  });

  it('notifies blocking approval waiters about rejection across executor harness instances', async () => {
    const waitingHarness = createCliActionExecutorHarness({
      token: 'token',
      sessionId: 'sess_1',
      ctx: {
        encryptionKey: new Uint8Array(32).fill(1),
        encryptionVariant: 'legacy',
      },
    });
    const decidingHarness = createCliActionExecutorHarness(
      {
        token: 'token',
        sessionId: 'sess_1',
        ctx: {
          encryptionKey: new Uint8Array(32).fill(1),
          encryptionVariant: 'legacy',
        },
      },
      {
        approvalsUpdate: vi.fn(async () => ({ ok: true as const })),
      },
    );

    const waitForDecision = waitingHarness.deps.approvalsWaitForDecision;
    expect(waitForDecision).toBeDefined();
    if (!waitForDecision) throw new Error('expected approvalsWaitForDecision');

    const pending = waitForDecision({
      artifactId: 'approval_shared_1',
      request: createApprovalRequest(),
    });

    await decidingHarness.deps.approvalsUpdate?.({
      artifactId: 'approval_shared_1',
      request: createApprovalRequest({
        status: 'rejected',
        decision: { kind: 'reject', decidedAtMs: 2 },
      }),
      serverId: null,
    });

    await expect(pending).resolves.toMatchObject({ decision: 'reject' });
  });

  it('lets a live blocking waiter claim an approval decision and return the session list result', async () => {
    const requests = new Map<string, ApprovalRequestV1>();
    const sessionList = vi.fn(async () => ({
      sessions: [{ id: 'sess_1', title: 'Current session' }],
      nextCursor: null,
    }));
    const sharedDeps: Partial<ActionExecutorDeps> = {
      approvalsCreate: vi.fn(async ({ request }) => {
        requests.set('approval_blocking_1', request);
        return { artifactId: 'approval_blocking_1' };
      }),
      approvalsGet: vi.fn(async ({ artifactId }) => requests.get(artifactId) ?? null),
      approvalsUpdate: vi.fn(async ({ artifactId, request }) => {
        requests.set(artifactId, request);
        return { ok: true as const };
      }),
      isActionEnabled: () => true,
      isActionApprovalRequired: (id, ctx) => id === 'session.list' && ctx.surface === 'session_agent',
      sessionList,
    };
    const waitingHarness = createCliActionExecutorHarness(
      {
        token: 'token',
        sessionId: 'sess_1',
        ctx: {
          encryptionKey: new Uint8Array(32).fill(1),
          encryptionVariant: 'legacy',
        },
      },
      sharedDeps,
    );
    const decidingHarness = createCliActionExecutorHarness(
      {
        token: 'token',
        sessionId: 'sess_1',
        ctx: {
          encryptionKey: new Uint8Array(32).fill(1),
          encryptionVariant: 'legacy',
        },
      },
      sharedDeps,
    );

    const pending = waitingHarness.executor.execute(
      'session.list',
      { limit: 1 },
      { surface: 'session_agent', defaultSessionId: 'sess_1' },
    );
    await Promise.resolve();

    const decideResult = await decidingHarness.executor.execute(
      'approval.request.decide' as any,
      { artifactId: 'approval_blocking_1', decision: 'approve' },
      { surface: 'cli', defaultSessionId: 'sess_1' },
    );

    expect(decideResult).toMatchObject({
      ok: true,
      result: {
        status: 'approved',
      },
    });
    await expect(pending).resolves.toEqual({
      ok: true,
      result: {
        sessions: [{ id: 'sess_1', title: 'Current session' }],
        nextCursor: null,
      },
    });
    expect(sessionList).toHaveBeenCalledTimes(1);
  });

  it('wakes a blocking waiter from durable executed approval state across process boundaries', async () => {
    process.env.HAPPIER_BLOCKING_APPROVAL_POLL_INTERVAL_MS = '1';
    const requests = new Map<string, ApprovalRequestV1>();
    const recordedResult = {
      sessions: [{ id: 'sess_1', title: 'Recorded session' }],
      nextCursor: null,
    };
    const sessionList = vi.fn(async () => ({
      sessions: [{ id: 'sess_2', title: 'Duplicate execution' }],
      nextCursor: null,
    }));
    const sharedDeps: Partial<ActionExecutorDeps> = {
      approvalsCreate: vi.fn(async ({ request }) => {
        requests.set('approval_cross_process_1', request);
        return { artifactId: 'approval_cross_process_1' };
      }),
      approvalsGet: vi.fn(async ({ artifactId }) => requests.get(artifactId) ?? null),
      approvalsUpdate: vi.fn(async ({ artifactId, request }) => {
        requests.set(artifactId, request);
        return { ok: true as const };
      }),
      isActionEnabled: () => true,
      isActionApprovalRequired: (id, ctx) => id === 'session.list' && ctx.surface === 'session_agent',
      sessionList,
    };
    const waitingHarness = createCliActionExecutorHarness(
      {
        token: 'token',
        sessionId: 'sess_1',
        ctx: {
          encryptionKey: new Uint8Array(32).fill(1),
          encryptionVariant: 'legacy',
        },
      },
      sharedDeps,
    );

    const pending = waitingHarness.executor.execute(
      'session.list',
      { limit: 1 },
      { surface: 'session_agent', defaultSessionId: 'sess_1' },
    );
    await Promise.resolve();
    const created = requests.get('approval_cross_process_1');
    expect(created).toBeDefined();
    requests.set('approval_cross_process_1', {
      ...(created as ApprovalRequestV1),
      status: 'executed',
      updatedAtMs: 3,
      decision: { kind: 'approve', decidedAtMs: 2 },
      execution: { executedAtMs: 3, ok: true, result: recordedResult },
    });

    await expect(pending).resolves.toEqual({
      ok: true,
      result: recordedResult,
    });
    expect(sessionList).not.toHaveBeenCalled();
  });

  it('notifies blocking approval waiters about terminal executed artifact updates', async () => {
    const approvalsUpdate = vi.fn(async () => ({ ok: true as const }));
    const harness = createCliActionExecutorHarness(
      {
        token: 'token',
        sessionId: 'sess_1',
        ctx: {
          encryptionKey: new Uint8Array(32).fill(1),
          encryptionVariant: 'legacy',
        },
      },
      {
        approvalsUpdate,
      },
    );

    const waitForDecision = harness.deps.approvalsWaitForDecision;
    expect(waitForDecision).toBeDefined();
    if (!waitForDecision) throw new Error('expected approvalsWaitForDecision');

    const pending = waitForDecision({
      artifactId: 'approval_terminal_executed_1',
      request: createApprovalRequest(),
    });

    await harness.deps.approvalsUpdate?.({
      artifactId: 'approval_terminal_executed_1',
      request: createApprovalRequest({
        status: 'executed',
        decision: { kind: 'approve', decidedAtMs: 2 },
        execution: {
          executedAtMs: 3,
          ok: true,
          result: {
            sessions: [{ id: 'sess_1', title: 'Recorded session' }],
            nextCursor: null,
          },
        },
      }),
      serverId: null,
    });

    await expect(pending).resolves.toMatchObject({
      decision: 'approve',
      request: {
        status: 'executed',
        execution: {
          ok: true,
          result: {
            sessions: [{ id: 'sess_1', title: 'Recorded session' }],
            nextCursor: null,
          },
        },
      },
    });
    expect(approvalsUpdate).toHaveBeenCalledTimes(1);
  });

  it('notifies blocking approval waiters about cancellation across executor harness instances', async () => {
    const waitingHarness = createCliActionExecutorHarness({
      token: 'token',
      sessionId: 'sess_1',
      ctx: {
        encryptionKey: new Uint8Array(32).fill(1),
        encryptionVariant: 'legacy',
      },
    });
    const decidingHarness = createCliActionExecutorHarness(
      {
        token: 'token',
        sessionId: 'sess_1',
        ctx: {
          encryptionKey: new Uint8Array(32).fill(1),
          encryptionVariant: 'legacy',
        },
      },
      {
        approvalsUpdate: vi.fn(async () => ({ ok: true as const })),
      },
    );

    const waitForDecision = waitingHarness.deps.approvalsWaitForDecision;
    expect(waitForDecision).toBeDefined();
    if (!waitForDecision) throw new Error('expected approvalsWaitForDecision');

    const pending = waitForDecision({
      artifactId: 'approval_shared_cancel_1',
      request: createApprovalRequest(),
    });

    await decidingHarness.deps.approvalsUpdate?.({
      artifactId: 'approval_shared_cancel_1',
      request: createApprovalRequest({
        status: 'canceled',
      }),
      serverId: null,
    });

    expect(await expectSettled(pending)).toMatchObject({ decision: 'canceled' });
  });
});
