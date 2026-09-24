import { describe, expect, it } from 'vitest';

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

type BudgetModule = {
  createDaemonServerWorkBudget?: (params: Readonly<{ maxConcurrentWrites: number }>) => DaemonServerWorkBudget;
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

async function loadBudgetModule(): Promise<BudgetModule> {
  try {
    const path = './createDaemonServerWorkBudget';
    return (await import(path)) as unknown as BudgetModule;
  } catch {
    return {};
  }
}

describe('createDaemonServerWorkBudget', () => {
  it('caps background writes globally while preserving queued work', async () => {
    const mod = await loadBudgetModule();

    expect(mod.createDaemonServerWorkBudget).toEqual(expect.any(Function));

    const budget = mod.createDaemonServerWorkBudget!({ maxConcurrentWrites: 1 });
    const barrier = createDeferred<void>();
    const events: string[] = [];

    const first = budget.run({ purpose: 'connectedServiceQuotaPersistence' }, async () => {
      events.push('first:start');
      await barrier.promise;
      events.push('first:end');
      return 'first';
    });
    const second = budget.run({ purpose: 'connectedServiceQuotaPersistence' }, async () => {
      events.push('second:start');
      return 'second';
    });

    await Promise.resolve();

    expect(events).toEqual(['first:start']);
    expect(budget.getSnapshot()).toMatchObject({
      activeCount: 1,
      queuedCount: 1,
      maxConcurrentWrites: 1,
    });

    barrier.resolve(undefined);

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
    expect(budget.getSnapshot()).toMatchObject({ activeCount: 0, queuedCount: 0 });
  });
});
