import type { ManagedConnectionState } from '@happier-dev/connection-supervisor';

import { afterEach, describe, expect, it, vi } from 'vitest';

type Logger = {
  debug: (message: string, ...args: readonly unknown[]) => void;
  warn: (message: string, ...args: readonly unknown[]) => void;
};

type DaemonServerWorkBudget = {
  run: <T>(
    metadata: Readonly<{ purpose: string }>,
    work: () => Promise<T>,
  ) => Promise<T>;
  getSnapshot: () => Readonly<{
    activeCount: number;
    queuedCount: number;
    maxConcurrentWrites: number;
  }>;
};

type DaemonServerWorkScheduler = {
  enqueue: <TPayload>(work: Readonly<{
    key: string;
    purpose: string;
    kind: string;
    payload: TPayload;
    payloadBytes: number;
    run: (payload: TPayload) => Promise<void>;
  }>) => Promise<Readonly<{ status: string; reason?: string; classification?: Readonly<{ kind: string; retryAfterMs?: number }> }>>;
  recordEvent: (event: Readonly<{ purpose: string; key: string; type: string; payloadBytes?: number }>) => void;
  getSnapshot: () => Readonly<{
    pendingKeyCount: number;
    pendingPayloadBytes: number;
    purposes: Record<string, Readonly<{ counters: Record<string, number> }>>;
    keys: Record<string, Readonly<{
      timeSinceLastSuccessMs: number | null;
      backoffReason: string | null;
      nextEligibleAt: number | null;
    }>>;
  }>;
  flushAll: (timeoutMs: number) => Promise<Readonly<{ timedOut: boolean }>>;
};

type SchedulerModule = {
	  createDaemonServerWorkScheduler?: (params: Readonly<{
	    budget: DaemonServerWorkBudget;
	    gate?: () => Readonly<{ status: 'open' } | { status: 'deferred'; reason: string } | { status: 'suppressed'; reason: string }>;
	    logger?: Logger;
	    maxTrackedKeys?: number;
	    now?: () => number;
	  }>) => DaemonServerWorkScheduler;
  createDaemonServerWorkGateFromSupervisor?: (supervisor: Readonly<{ getState: () => ManagedConnectionState }>) => () => Readonly<
    { status: 'open' } | { status: 'deferred'; reason: string }
  >;
};

type BudgetModule = {
  createDaemonServerWorkBudget?: (params: Readonly<{ maxConcurrentWrites: number }>) => DaemonServerWorkBudget;
};

type ShutdownModule = {
  createDaemonServerWorkShutdownFlush?: (params: Readonly<{
    scheduler: Pick<DaemonServerWorkScheduler, 'flushAll'>;
    timeoutMs?: number;
  }>) => () => Promise<void>;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function loadSchedulerModule(): Promise<SchedulerModule> {
  try {
    const path = './createDaemonServerWorkScheduler';
    return (await import(path)) as unknown as SchedulerModule;
  } catch {
    return {};
  }
}

async function loadBudgetModule(): Promise<BudgetModule> {
  try {
    const path = './createDaemonServerWorkBudget';
    return (await import(path)) as unknown as BudgetModule;
  } catch {
    return {};
  }
}

async function loadShutdownModule(): Promise<ShutdownModule> {
  try {
    const path = './createDaemonServerWorkShutdownFlush';
    return (await import(path)) as unknown as ShutdownModule;
  } catch {
    return {};
  }
}

function buildState(phase: ManagedConnectionState['phase']): ManagedConnectionState {
  return {
    phase,
    reason: phase === 'auth_failed' ? 'auth_invalid' : phase === 'offline' ? 'server_unreachable' : null,
    attempt: 0,
    nextRetryAt: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastErrorMessage: null,
  };
}

describe('createDaemonServerWorkScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('defers work while the supervisor is offline or auth-failed', async () => {
    const [schedulerMod, budgetMod] = await Promise.all([loadSchedulerModule(), loadBudgetModule()]);

    expect(schedulerMod.createDaemonServerWorkScheduler).toEqual(expect.any(Function));
    expect(schedulerMod.createDaemonServerWorkGateFromSupervisor).toEqual(expect.any(Function));
    expect(budgetMod.createDaemonServerWorkBudget).toEqual(expect.any(Function));

    let state = buildState('offline');
    const gate = schedulerMod.createDaemonServerWorkGateFromSupervisor!({ getState: () => state });
    const scheduler = schedulerMod.createDaemonServerWorkScheduler!({
      budget: budgetMod.createDaemonServerWorkBudget!({ maxConcurrentWrites: 1 }),
      gate,
      now: () => 1000,
    });
    const run = vi.fn(async () => {});

    await expect(
      scheduler.enqueue({
        key: 'quota:profile-1',
        purpose: 'connectedServiceQuotaPersistence',
        kind: 'latestStateWrite',
        payload: { id: 1 },
        payloadBytes: 11,
        run,
      }),
    ).resolves.toMatchObject({ status: 'deferred', reason: 'offline' });
    expect(run).not.toHaveBeenCalled();

    state = buildState('auth_failed');

    await expect(
      scheduler.enqueue({
        key: 'quota:profile-1',
        purpose: 'connectedServiceQuotaPersistence',
        kind: 'latestStateWrite',
        payload: { id: 2 },
        payloadBytes: 11,
        run,
      }),
    ).resolves.toMatchObject({ status: 'deferred', reason: 'auth_failed' });
    expect(scheduler.getSnapshot().purposes.connectedServiceQuotaPersistence?.counters.deferred).toBe(2);
  });

  it('tracks per-purpose counters and pending payload bytes without hot success logs', async () => {
    const [schedulerMod, budgetMod] = await Promise.all([loadSchedulerModule(), loadBudgetModule()]);

    expect(schedulerMod.createDaemonServerWorkScheduler).toEqual(expect.any(Function));
    expect(budgetMod.createDaemonServerWorkBudget).toEqual(expect.any(Function));

    let now = 1000;
    const logger: Logger = { debug: vi.fn(), warn: vi.fn() };
    const scheduler = schedulerMod.createDaemonServerWorkScheduler!({
      budget: budgetMod.createDaemonServerWorkBudget!({ maxConcurrentWrites: 1 }),
      gate: () => ({ status: 'open' }),
      logger,
      now: () => now,
    });
    const barrier = createDeferred<void>();

    const first = scheduler.enqueue({
      key: 'quota:profile-1',
      purpose: 'connectedServiceQuotaPersistence',
      kind: 'latestStateWrite',
      payload: { id: 1 },
      payloadBytes: 17,
      run: async () => {
        await barrier.promise;
      },
    });

    await Promise.resolve();
    expect(scheduler.getSnapshot()).toMatchObject({
      pendingKeyCount: 1,
      pendingPayloadBytes: 17,
    });

    barrier.resolve(undefined);
    await expect(first).resolves.toMatchObject({ status: 'written' });

    now = 2500;
    scheduler.recordEvent({ purpose: 'connectedServiceQuotaPersistence', key: 'quota:profile-1', type: 'coalesced', payloadBytes: 19 });
    scheduler.recordEvent({ purpose: 'connectedServiceQuotaPersistence', key: 'quota:profile-1', type: 'suppressed' });
    scheduler.recordEvent({ purpose: 'connectedServiceQuotaPersistence', key: 'quota:profile-1', type: 'retried' });

    const snapshot = scheduler.getSnapshot();
    expect(snapshot.purposes.connectedServiceQuotaPersistence?.counters).toMatchObject({
      accepted: 1,
      coalesced: 1,
      suppressed: 1,
      written: 1,
      failed: 0,
      deferred: 0,
      retried: 1,
    });
    expect(snapshot.keys['quota:profile-1']).toMatchObject({
      timeSinceLastSuccessMs: 1500,
      backoffReason: null,
      nextEligibleAt: null,
    });
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

	  it('records retry-after backoff diagnostics for failed work', async () => {
    const [schedulerMod, budgetMod] = await Promise.all([loadSchedulerModule(), loadBudgetModule()]);

    expect(schedulerMod.createDaemonServerWorkScheduler).toEqual(expect.any(Function));
    expect(budgetMod.createDaemonServerWorkBudget).toEqual(expect.any(Function));

    const logger: Logger = { debug: vi.fn(), warn: vi.fn() };
    const scheduler = schedulerMod.createDaemonServerWorkScheduler!({
      budget: budgetMod.createDaemonServerWorkBudget!({ maxConcurrentWrites: 1 }),
      gate: () => ({ status: 'open' }),
      logger,
      now: () => 1000,
    });

    await expect(
      scheduler.enqueue({
        key: 'quota:profile-1',
        purpose: 'connectedServiceQuotaPersistence',
        kind: 'latestStateWrite',
        payload: { id: 1 },
        payloadBytes: 17,
        run: async () => {
          throw { response: { status: 429, headers: { 'retry-after': '2' } } };
        },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      classification: {
        kind: 'rate_limited',
        retryAfterMs: 2000,
      },
    });

    const snapshot = scheduler.getSnapshot();
    expect(snapshot.purposes.connectedServiceQuotaPersistence?.counters).toMatchObject({
      accepted: 1,
      written: 0,
      failed: 1,
      retried: 1,
    });
    expect(snapshot.keys['quota:profile-1']).toMatchObject({
      backoffReason: 'rate_limited',
      nextEligibleAt: 3000,
    });
	    expect(logger.warn).toHaveBeenCalledTimes(1);
	  });

	  it('bounds sampled per-key diagnostics', async () => {
	    const [schedulerMod, budgetMod] = await Promise.all([loadSchedulerModule(), loadBudgetModule()]);

	    expect(schedulerMod.createDaemonServerWorkScheduler).toEqual(expect.any(Function));
	    expect(budgetMod.createDaemonServerWorkBudget).toEqual(expect.any(Function));

	    let now = 1000;
	    const scheduler = schedulerMod.createDaemonServerWorkScheduler!({
	      budget: budgetMod.createDaemonServerWorkBudget!({ maxConcurrentWrites: 1 }),
	      gate: () => ({ status: 'open' }),
	      maxTrackedKeys: 2,
	      now: () => now,
	    });

	    for (const key of ['quota:profile-1', 'quota:profile-2', 'quota:profile-3']) {
	      await scheduler.enqueue({
	        key,
	        purpose: 'connectedServiceQuotaPersistence',
	        kind: 'latestStateWrite',
	        payload: { key },
	        payloadBytes: 17,
	        run: async () => {},
	      });
	      now += 1000;
	    }

	    const snapshot = scheduler.getSnapshot();
	    expect(Object.keys(snapshot.keys)).toEqual(['quota:profile-2', 'quota:profile-3']);
	  });

	  it('samples repeated failure logs for the same key and reason', async () => {
    const [schedulerMod, budgetMod] = await Promise.all([loadSchedulerModule(), loadBudgetModule()]);

    expect(schedulerMod.createDaemonServerWorkScheduler).toEqual(expect.any(Function));
    expect(budgetMod.createDaemonServerWorkBudget).toEqual(expect.any(Function));

    let now = 1000;
    const logger: Logger = { debug: vi.fn(), warn: vi.fn() };
    const scheduler = schedulerMod.createDaemonServerWorkScheduler!({
      budget: budgetMod.createDaemonServerWorkBudget!({ maxConcurrentWrites: 1 }),
      gate: () => ({ status: 'open' }),
      logger,
      now: () => now,
    });

    const failingWork = {
      key: 'quota:profile-1',
      purpose: 'connectedServiceQuotaPersistence',
      kind: 'latestStateWrite',
      payload: { id: 1 },
      payloadBytes: 17,
      run: async () => {
        throw { response: { status: 500 } };
      },
    };

    await scheduler.enqueue(failingWork);
    await scheduler.enqueue(failingWork);

    expect(logger.warn).toHaveBeenCalledTimes(1);

    now = 62_000;
    await scheduler.enqueue(failingWork);

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('flushAll resolves within the supplied timeout while pending work remains', async () => {
    vi.useFakeTimers();
    const [schedulerMod, budgetMod] = await Promise.all([loadSchedulerModule(), loadBudgetModule()]);

    expect(schedulerMod.createDaemonServerWorkScheduler).toEqual(expect.any(Function));
    expect(budgetMod.createDaemonServerWorkBudget).toEqual(expect.any(Function));

    const scheduler = schedulerMod.createDaemonServerWorkScheduler!({
      budget: budgetMod.createDaemonServerWorkBudget!({ maxConcurrentWrites: 1 }),
      gate: () => ({ status: 'open' }),
    });
    const barrier = createDeferred<void>();

    const pending = scheduler.enqueue({
      key: 'quota:profile-1',
      purpose: 'connectedServiceQuotaPersistence',
      kind: 'latestStateWrite',
      payload: { id: 1 },
      payloadBytes: 17,
      run: async () => {
        await barrier.promise;
      },
    });
    await Promise.resolve();

    const flush = scheduler.flushAll(2000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(flush).resolves.toMatchObject({ timedOut: true });

    barrier.resolve(undefined);
    await expect(pending).resolves.toMatchObject({ status: 'written' });
  });
});

describe('createDaemonServerWorkShutdownFlush', () => {
  it('calls scheduler.flushAll with the daemon shutdown timeout', async () => {
    const mod = await loadShutdownModule();

    expect(mod.createDaemonServerWorkShutdownFlush).toEqual(expect.any(Function));

    const flushAll = vi.fn(async () => ({ timedOut: false }));
    const beforeShutdown = mod.createDaemonServerWorkShutdownFlush!({
      scheduler: { flushAll },
      timeoutMs: 2000,
    });

    await beforeShutdown();

    expect(flushAll).toHaveBeenCalledWith(2000);
  });
});
