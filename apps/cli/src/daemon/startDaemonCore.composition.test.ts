import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Machine } from '@/api/types';
import type { DaemonCapabilities, DaemonCapabilityFactory, DaemonLifecycleContext, DaemonMachineApi, DaemonMachineConnection } from './lifecycle/daemonCapabilities';
import { startDaemonCore } from './startDaemonCore';

const boundary = vi.hoisted(() => ({
  events: [] as string[], owned: true,
  stateWrites: [] as Array<{ machineId?: string; pid: number; startedAt: number }>,
  clear: vi.fn<(_options: unknown) => Promise<boolean>>(async () => true),
}));
// 替换外部身份、进程和持久化边界；运行真实生命周期、注册外围和关闭预算。
vi.mock('@/ui/auth', () => ({ authAndSetupMachineIfNeeded: async () => {
  boundary.events.push('auth');
  return { credentials: { token: 'synthetic-token', encryption: { type: 'legacy', secret: new Uint8Array(32) } }, machineId: 'initial-machine' };
} }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn(), warn: vi.fn(), info: vi.fn(), logFilePath: 'fixture-log' } }));
vi.mock('@/persistence', () => ({
  readCredentials: vi.fn(), readSettings: vi.fn(), updateSettings: vi.fn(),
  acquireDaemonLock: async () => { boundary.events.push('lock'); return { fixture: true }; },
  releaseDaemonLock: async () => { boundary.events.push('unlock'); },
  writeDaemonStateIfLockOwned: (state: { machineId?: string; pid: number; startedAt: number }) => {
    boundary.events.push(`state:${state.machineId}`); boundary.stateWrites.push({ ...state }); return boundary.owned;
  },
  clearDaemonState: (options: unknown) => { boundary.events.push('clear-state'); return boundary.clear(options); },
}));
vi.mock('./startup/waitForInitialCredentials', () => ({ waitForInitialCredentials: async () => ({ action: 'continue', daemonLockHandle: null }) }));
vi.mock('@/daemon/ownership/evaluateCurrentDaemonOwner', () => ({ evaluateCurrentDaemonOwner: async () => ({ kind: 'none' }) }));
vi.mock('@/daemon/ownership/daemonServiceInventory', () => ({ evaluateDaemonStartupServiceConflict: async () => ({ kind: 'none' }) }));
vi.mock('@/daemon/service/cli', () => ({ resolveDaemonServiceCliRuntimeFromEnv: () => ({}) }));
vi.mock('./multiDaemon', () => ({ reapSameHomeDaemonOrphansBeforeStart: async () => ({ stoppedPids: [], failedPids: [] }) }));
vi.mock('./controlClient', () => ({
  isDaemonRunningCurrentlyInstalledHappyVersion: async () => false,
  stopDaemon: async () => { boundary.events.push('stop-existing'); }, forceStopKnownDaemonPid: vi.fn(),
}));
vi.mock('./machine/metadata', () => ({ getPreferredHostName: async () => 'fixture-host', initialMachineMetadata: {} }));
vi.mock('@/integrations/caffeinate', () => ({
  startCaffeinate: () => { boundary.events.push('caffeinate'); return true; },
  stopCaffeinate: async () => { boundary.events.push('stop-caffeinate'); },
}));

/** 用可控 Promise 表示外部等待，不请求网络或启动真实服务。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
function machine(id: string): Machine {
  return { id, encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy', metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0 };
}
/** 非空合成能力让每个阶段、连接、心跳及关闭端口都能被观察。 */
function fixture() {
  let context!: DaemonLifecycleContext;
  const connected = deferred<void>(); const heartbeat = setInterval(() => {}, 60_000);
  const getOrCreateMachine = vi.fn<DaemonMachineApi['getOrCreateMachine']>(async () => { boundary.events.push('register'); return machine('initial-machine'); });
  const awaitPendingRpcRequests = vi.fn(async () => { boundary.events.push('rpc-drain'); });
  const connection: DaemonMachineConnection = {
    awaitPendingRpcRequests,
    updateDaemonState: vi.fn(async () => { boundary.events.push('publish-shutdown'); }),
    shutdown: vi.fn(async () => { boundary.events.push('connection-stop'); }),
  };
  let pendingSpawns = 0;
  const capabilities: DaemonCapabilities = {
    shutdownWork: {
      quiesceProducers: vi.fn(async () => { boundary.events.push('quiesce'); }),
      flushQuotaPersistence: vi.fn(async () => { boundary.events.push('flush-quota'); }),
      flushAccountUsagePersistence: vi.fn(async () => { boundary.events.push('flush-account'); }),
      flushServerWork: vi.fn(async () => { boundary.events.push('flush-server'); }),
      inFlightSpawnCount: () => pendingSpawns,
      abortSpawns: vi.fn(() => { boundary.events.push('abort-spawns'); pendingSpawns = 0; }),
      spawnDrainGraceMs: 300, spawnDrainPollMs: 10,
    },
    initialDaemonStateExtensions: { daemonPendingSessionActivationSupported: true },
    startControl: vi.fn(async () => { boundary.events.push('control'); return { port: 32101, stop: async () => { boundary.events.push('control-stop'); } }; }),
    startPeer: vi.fn(async () => { boundary.events.push('peer'); }),
    prepareStatePublication: vi.fn(() => { boundary.events.push('prepare-publication'); return () => { boundary.events.push('broker'); }; }),
    startPublishedCapabilities: vi.fn(async () => {
      boundary.events.push('consumers');
      return { attachMachine: async () => { boundary.events.push('attach'); context.state.apiMachine = connection; connected.resolve(); } };
    }),
    startHeartbeat: vi.fn(() => { boundary.events.push('heartbeat'); return heartbeat; }),
    stopBeforeWatchdog: vi.fn(() => { boundary.events.push('stop-timers'); }),
    disposeBeforeMachineShutdown: vi.fn(async () => { boundary.events.push('dispose-producers'); }),
    detachMachineObserver: vi.fn(() => { boundary.events.push('off-connection'); }),
    disposeAfterMachineShutdown: vi.fn(async () => { boundary.events.push('workers-stop'); }),
    stopPeer: vi.fn(async () => { boundary.events.push('peer-stop'); }),
  };
  const factory: DaemonCapabilityFactory<DaemonMachineApi> = {
    describeEnvironment: () => ({}),
    createApi: async () => { boundary.events.push('api'); return { getOrCreateMachine }; },
    initialize: async (lifecycle) => { context = lifecycle; boundary.events.push('initialize'); return capabilities; },
  };
  return { factory, capabilities, getOrCreateMachine, awaitPendingRpcRequests, connection, connected,
    context: () => context, setPendingSpawns: (count: number) => { pendingSpawns = count; }, dispose: () => clearInterval(heartbeat) };
}
const processEvents = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', 'exit', 'beforeExit'] as const;
let listeners: Map<string, Function[]>;
const fixtures: ReturnType<typeof fixture>[] = [];
function createFixture() { const h = fixture(); fixtures.push(h); return h; }
beforeEach(() => {
  boundary.events = []; boundary.owned = true; boundary.stateWrites = []; boundary.clear.mockReset().mockResolvedValue(true);
  listeners = new Map(processEvents.map((event) => [event, process.rawListeners(event)]));
  vi.stubEnv('HAPPIER_DAEMON_STARTUP_SOURCE', 'manual'); vi.stubEnv('HAPPIER_DAEMON_SELF_RESTART_CORRELATION_ID', ''); vi.stubEnv('HAPPIER_DAEMON_TAKEOVER', '0');
  vi.spyOn(process, 'exit').mockImplementation((code) => { boundary.events.push(`exit:${code}`); return undefined as never; });
});
afterEach(() => {
  for (const event of processEvents) for (const listener of process.rawListeners(event)) if (!listeners.get(event)?.includes(listener)) process.removeListener(event, listener);
  for (const h of fixtures.splice(0)) h.dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs();
});

describe('shared daemon lifecycle composition', () => {
  it('runs phases once and preserves publication, registration and teardown order', async () => {
    const h = createFixture(); const running = startDaemonCore(h.factory); await h.connected.promise;
    h.context().requestShutdown('happier-cli'); await running;
    expect(boundary.events).toEqual([
      'auth', 'api', 'stop-existing', 'lock', 'caffeinate', 'initialize', 'control', 'peer',
      'prepare-publication', 'state:initial-machine', 'broker', 'consumers', 'register', 'heartbeat', 'attach',
      'stop-timers', 'clear-state', 'quiesce', 'flush-quota', 'flush-account', 'flush-server', 'rpc-drain',
      'flush-quota', 'flush-server', 'dispose-producers', 'off-connection', 'publish-shutdown', 'connection-stop',
      'workers-stop', 'peer-stop', 'control-stop', 'stop-caffeinate', 'unlock', 'exit:0',
    ]);
    expect(h.capabilities.startControl).toHaveBeenCalledOnce(); expect(h.context().state.shutdownInitiated).toBe(true);
    expect(h.context().state.apiMachine).toBe(h.connection);
  });
  it('keeps state available during registration and ignores late success after shutdown', async () => {
    const h = createFixture(); const registration = deferred<Machine>(); h.getOrCreateMachine.mockReturnValue(registration.promise);
    const running = startDaemonCore(h.factory); await vi.waitFor(() => expect(boundary.events).toContain('heartbeat'));
    expect(boundary.events).toContain('broker'); expect(boundary.events).not.toContain('attach');
    h.context().requestShutdown('happier-cli'); await running;
    registration.resolve(machine('late-machine')); await registration.promise; await Promise.resolve(); await Promise.resolve();
    expect(boundary.events).not.toContain('attach'); expect(boundary.stateWrites).toHaveLength(1);
  });
  it('does not publish broker or start consumers after losing the lifecycle lock', async () => {
    const h = createFixture(); boundary.owned = false; await startDaemonCore(h.factory);
    expect(boundary.events).toContain('prepare-publication'); expect(boundary.events).not.toContain('broker'); expect(boundary.events).not.toContain('consumers');
    expect(boundary.events.slice(-2)).toEqual(['unlock', 'exit:1']); expect(boundary.clear).not.toHaveBeenCalled();
  });
  it('preserves startup failure cleanup when the control listener fails', async () => {
    const h = createFixture(); vi.mocked(h.capabilities.startControl).mockRejectedValue(new Error('synthetic-bind-failure')); await startDaemonCore(h.factory);
    expect(boundary.events).not.toContain('peer'); expect(boundary.stateWrites).toHaveLength(0);
    expect(boundary.events.slice(-2)).toEqual(['unlock', 'exit:1']); expect(h.capabilities.disposeBeforeMachineShutdown).not.toHaveBeenCalled();
  });
  it('clears only the owned publication when published capability startup fails', async () => {
    const h = createFixture(); vi.mocked(h.capabilities.startPublishedCapabilities).mockRejectedValue(new Error('synthetic-capability-failure')); await startDaemonCore(h.factory);
    expect(boundary.clear).toHaveBeenCalledWith({ expectedOwner: { pid: process.pid, startedAt: boundary.stateWrites[0].startedAt } });
    expect(h.getOrCreateMachine).not.toHaveBeenCalled(); expect(boundary.events.slice(-3)).toEqual(['clear-state', 'unlock', 'exit:1']);
  });
  it('shares one drain and waits for pending RPC before disconnecting', async () => {
    const h = createFixture(); const pending = deferred<void>(); h.awaitPendingRpcRequests.mockImplementation(async () => { boundary.events.push('rpc-drain'); await pending.promise; });
    const running = startDaemonCore(h.factory); await h.connected.promise;
    const first = h.context().beforeShutdown(); const second = h.context().beforeShutdown(); h.context().requestShutdown('happier-cli');
    await vi.waitFor(() => expect(h.awaitPendingRpcRequests).toHaveBeenCalledOnce()); expect(boundary.events).not.toContain('connection-stop');
    pending.resolve(); await Promise.all([first, second, running]);
    expect(h.capabilities.shutdownWork.quiesceProducers).toHaveBeenCalledOnce(); expect(h.capabilities.shutdownWork.flushServerWork).toHaveBeenCalledTimes(2);
    expect(boundary.events.indexOf('off-connection')).toBeLessThan(boundary.events.indexOf('connection-stop'));
  });
  it('uses one shutdown budget for queued spawns and RPC requests', async () => {
    const h = createFixture(); const original = h.capabilities.shutdownWork;
    Object.defineProperty(h.capabilities, 'shutdownWork', { value: { ...original, spawnDrainGraceMs: 10, spawnDrainPollMs: 10 } }); h.setPendingSpawns(1);
    const running = startDaemonCore(h.factory); await h.connected.promise; h.context().requestShutdown('happier-cli'); await running;
    expect(original.abortSpawns).toHaveBeenCalledOnce(); expect(h.awaitPendingRpcRequests).not.toHaveBeenCalled(); expect(boundary.events).toContain('connection-stop');
  });

  it.each(['initialize', 'control', 'peer', 'consumers'] as const)('preserves a shutdown request arriving at the %s continuation', async (stage) => {
    const h = createFixture();
    const requestShutdown = () => h.context().requestShutdown('happier-cli');
    let factory = h.factory;
    if (stage === 'initialize') {
      factory = { ...h.factory, initialize: async (...args) => {
        const capabilities = await h.factory.initialize(...args); requestShutdown(); return capabilities;
      } };
    } else if (stage === 'control') {
      const original = h.capabilities.startControl;
      vi.mocked(original).mockImplementationOnce(async () => {
        boundary.events.push('control'); requestShutdown(); return { port: 32101, stop: async () => { boundary.events.push('control-stop'); } };
      });
    } else if (stage === 'peer') {
      vi.mocked(h.capabilities.startPeer).mockImplementationOnce(async () => { boundary.events.push('peer'); requestShutdown(); });
    } else {
      vi.mocked(h.capabilities.startPublishedCapabilities).mockImplementationOnce(async () => {
        boundary.events.push('consumers'); requestShutdown();
        return { attachMachine: async () => { boundary.events.push('unexpected-attach'); } };
      });
    }
    await startDaemonCore(factory);
    // 原语义在完成初始化后统一处理 shutdown；请求本身不冒充 shutdownInitiated。
    expect(boundary.stateWrites).toHaveLength(1);
    expect(boundary.events.filter((event) => event === 'broker')).toHaveLength(1);
    expect(boundary.events).not.toContain('attach'); expect(boundary.events).not.toContain('unexpected-attach');
    expect(h.context().state.shutdownInitiated).toBe(true);
    expect(boundary.events.slice(-2)).toEqual(['unlock', 'exit:0']);
  });
});
