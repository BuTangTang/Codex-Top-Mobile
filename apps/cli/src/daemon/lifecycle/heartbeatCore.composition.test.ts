import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DaemonHeartbeatCoreOptions } from './heartbeatCore';

const missingPid = 999_991;
const syntheticSuccessorPid = 999_992;
let home: string;
let releaseLock: (() => Promise<void>) | undefined;

// 用独立目录和真实持久锁构造共享核，只替换系统计时器与合成PID探测。
async function createHeartbeatFixture(overrides: Partial<DaemonHeartbeatCoreOptions> = {}) {
  const { configuration } = await import('@/configuration');
  const persistence = await import('@/persistence');
  const { startDaemonHeartbeatLoopCore } = await import('./heartbeatCore');
  const lock = await persistence.acquireDaemonLock(1);
  expect(lock).not.toBeNull();
  releaseLock = () => persistence.releaseDaemonLock(lock!);
  const version = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version as string;
  const fileState = {
    pid: process.pid,
    httpPort: 8765,
    startedAt: 1,
    startedWithCliVersion: version,
    runtimeId: 'synthetic-heartbeat-runtime',
    machineId: 'synthetic-machine',
    lastHeartbeatAt: 1,
    daemonLogPath: join(home, 'logs', 'synthetic.log'),
    controlToken: 'synthetic-control-token',
  };
  expect(persistence.writeDaemonStateIfLockOwned(fileState)).toBe(true);
  let tick: (() => Promise<void>) | undefined;
  const interval = vi.spyOn(globalThis, 'setInterval').mockImplementation(((handler: () => Promise<void>) => {
    tick = handler;
    return {} as NodeJS.Timeout;
  }) as typeof setInterval);
  const requestShutdown = vi.fn<DaemonHeartbeatCoreOptions['requestShutdown']>();
  const requestSelfRestart = vi.fn<DaemonHeartbeatCoreOptions['requestSelfRestart']>(async () => ({ status: 'replacement_not_confirmed' as const }));
  const params = {
    pidToTrackedSession: new Map(),
    spawnResourceCleanupByPid: new Map(),
    sessionAttachCleanupByPid: new Map(),
    onChildExited: vi.fn<DaemonHeartbeatCoreOptions['onChildExited']>(),
    controlPort: 8765,
    fileState,
    currentCliVersion: version,
    requestShutdown,
    requestSelfRestart,
    ...overrides,
  };
  startDaemonHeartbeatLoopCore(params);
  expect(interval).toHaveBeenCalledTimes(1);
  expect(interval.mock.calls[0][1]).toBe(60_000);
  expect(tick).toBeTypeOf('function');
  return {
    tick: tick!,
    params,
    configuration,
    persistence,
    requestShutdown,
    requestSelfRestart,
    readState: async () => JSON.parse(await readFile(configuration.daemonStateFile, 'utf8')),
  };
}

describe('heartbeatCore composition', () => {
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'happier-heartbeat-core-'));
    vi.stubEnv('HAPPIER_HOME_DIR', home);
    vi.stubEnv('HAPPIER_DAEMON_HEARTBEAT_INTERVAL', '');
    vi.resetModules();
    const originalKill = process.kill.bind(process);
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === missingPid && signal === 0) {
        throw Object.assign(new Error('synthetic process missing'), { code: 'ESRCH' });
      }
      return originalKill(pid, signal);
    }) as typeof process.kill);
  });

  afterEach(async () => {
    await releaseLock?.();
    releaseLock = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('starts recovery immediately and keeps wait, prune, maintenance, cleanup and publication in order', async () => {
    const events: string[] = [];
    let completeRecovery!: () => void;
    const recovery = new Promise<void>((resolve) => { completeRecovery = resolve; });
    const tracked = new Map([[missingPid, { startedBy: 'daemon', pid: missingPid }]]);
    const spawnCleanups = new Map([[missingPid, () => { events.push('spawn-cleanup'); }]]);
    const attachCleanups = new Map([[missingPid, async () => { events.push('attach-cleanup'); }]]);
    const fixture = await createHeartbeatFixture({
      pidToTrackedSession: tracked,
      spawnResourceCleanupByPid: spawnCleanups,
      sessionAttachCleanupByPid: attachCleanups,
      onChildExited: (pid, exit) => {
        expect(exit).toEqual({ reason: 'process-missing', code: null, signal: null });
        events.push('prune');
        tracked.delete(pid);
      },
      createMaintenance: () => ({
        startRecovery: () => { events.push('start'); },
        waitForRecovery: async () => { events.push('wait'); await recovery; },
        afterPrune: async ({ isPidAlive }) => {
          expect(isPidAlive(missingPid)).toBe(false);
          expect(spawnCleanups.has(missingPid)).toBe(true);
          events.push('maintenance');
        },
      }),
    });
    expect(events).toEqual(['start']);
    const firstTick = fixture.tick();
    await fixture.tick();
    expect(events).toEqual(['start', 'wait']);
    expect((await fixture.readState()).lastHeartbeatAt).toBe(1);
    completeRecovery();
    await firstTick;
    expect(events).toEqual(['start', 'wait', 'prune', 'maintenance', 'spawn-cleanup', 'attach-cleanup']);
    expect(spawnCleanups.size).toBe(0);
    expect(attachCleanups.size).toBe(0);
    expect((await fixture.readState()).lastHeartbeatAt).toBeGreaterThan(1);
    expect(fixture.requestSelfRestart).not.toHaveBeenCalled();
    expect(fixture.requestShutdown).not.toHaveBeenCalled();
  });

  it('publishes with no maintenance capability while retaining the real owner lock', async () => {
    const fixture = await createHeartbeatFixture();
    await fixture.tick();
    expect(await fixture.readState()).toEqual(expect.objectContaining({
      pid: process.pid,
      runtimeId: 'synthetic-heartbeat-runtime',
      machineId: 'synthetic-machine',
      controlToken: 'synthetic-control-token',
    }));
    expect((await fixture.readState()).lastHeartbeatAt).toBeGreaterThan(1);
    expect(fixture.requestShutdown).not.toHaveBeenCalled();
  });

  it('releases singleflight after an injected maintenance failure', async () => {
    const afterPrune = vi.fn()
      .mockRejectedValueOnce(new Error('synthetic maintenance failure'))
      .mockResolvedValue(undefined);
    const startRecovery = vi.fn();
    const fixture = await createHeartbeatFixture({
      createMaintenance: () => ({ startRecovery, waitForRecovery: async () => {}, afterPrune }),
    });
    await fixture.tick();
    expect((await fixture.readState()).lastHeartbeatAt).toBe(1);
    await fixture.tick();
    expect((await fixture.readState()).lastHeartbeatAt).toBeGreaterThan(1);
    expect(afterPrune).toHaveBeenCalledTimes(2);
    expect(startRecovery).toHaveBeenCalledTimes(1);
  });

  it('skips both a shutdown tick and publication when shutdown begins during maintenance', async () => {
    let shuttingDown = true;
    const waitForRecovery = vi.fn(async () => {});
    const fixture = await createHeartbeatFixture({
      isShuttingDown: () => shuttingDown,
      createMaintenance: () => ({
        startRecovery: () => {},
        waitForRecovery,
        afterPrune: async () => { shuttingDown = true; },
      }),
    });
    await fixture.tick();
    expect(waitForRecovery).not.toHaveBeenCalled();
    shuttingDown = false;
    await fixture.tick();
    expect(waitForRecovery).toHaveBeenCalledTimes(1);
    expect((await fixture.readState()).lastHeartbeatAt).toBe(1);
    expect(fixture.requestShutdown).not.toHaveBeenCalled();
  });

  it('preserves an already published successor and requests shutdown', async () => {
    const fixture = await createHeartbeatFixture();
    fixture.persistence.writeDaemonState({ ...fixture.params.fileState, pid: syntheticSuccessorPid });
    await fixture.tick();
    expect((await fixture.readState()).pid).toBe(syntheticSuccessorPid);
    expect(fixture.requestShutdown).toHaveBeenCalledWith('exception',
      'A different daemon was started without killing us. We should kill ourselves.');
  });

  it('does not publish after lock ownership changes during maintenance', async () => {
    let lockPath: string;
    const fixture = await createHeartbeatFixture({
      createMaintenance: () => ({
        startRecovery: () => {},
        waitForRecovery: async () => {},
        afterPrune: async () => { await writeFile(lockPath, String(syntheticSuccessorPid)); },
      }),
    });
    lockPath = fixture.configuration.daemonLockFile;
    await fixture.tick();
    expect((await fixture.readState()).lastHeartbeatAt).toBe(1);
    expect(fixture.requestShutdown).toHaveBeenCalledWith('exception',
      'Daemon lifecycle lock ownership changed before heartbeat publication.');
  });
});
