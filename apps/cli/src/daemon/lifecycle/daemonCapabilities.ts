import type { ApiClientCore } from '@/api/apiCore';
import type { ApiMachineClientCore } from '@/api/apiMachineCore';
import type { Credentials, DaemonLocallyPersistedState } from '@/persistence';
import type { DaemonState } from '@/api/types';
import type { ensureMachineRegistered } from '@/api/machine/ensureMachineRegistered';
import type { DaemonStartupSource } from '../ownership/daemonOwnershipMetadata';
import type { DaemonDiagnosticSubsystemGates } from '../startup/diagnosticSubsystemGates';
import type { createDaemonShutdownController } from './shutdown';
import type { RequestDaemonSelfRestart } from './heartbeatCore';

export type DaemonRegistration = Awaited<ReturnType<typeof ensureMachineRegistered>>;
export type DaemonMachineApi = Pick<ApiClientCore, 'getOrCreateMachine'>;
export type DaemonMachineConnection = Pick<ApiMachineClientCore, 'awaitPendingRpcRequests' | 'updateDaemonState' | 'shutdown'>;

/** 唯一生命周期持有的实时槽；能力工厂使用同一身份、连接和关闭标记。 */
export type DaemonLifecycleState = {
  machineId: string;
  apiMachine: DaemonMachineConnection | null;
  shutdownInitiated: boolean;
};

/** 工厂只能接入已有生命周期，不另建锁、连接或退出控制器。 */
export type DaemonLifecycleContext = Readonly<{
  credentials: Credentials;
  runtimeId: string;
  startupSource: DaemonStartupSource;
  serviceLabel: string | undefined;
  preferredHost: string;
  diagnosticSubsystemGates: DaemonDiagnosticSubsystemGates;
  takeoverRequested: boolean;
  state: DaemonLifecycleState;
  requestShutdown: ReturnType<typeof createDaemonShutdownController>['requestShutdown'];
  isDaemonShutdownRequested: () => boolean;
  resolvesWhenShutdownRequested: ReturnType<typeof createDaemonShutdownController>['resolvesWhenShutdownRequested'];
  requestSelfRestart: RequestDaemonSelfRestart;
  beforeShutdown: () => Promise<void>;
}>;

/** 业务队列在原位置接入共享关闭预算，不持有第二个计时器或 drain owner。 */
export type DaemonShutdownWork = Readonly<{
  quiesceProducers: () => Promise<void>;
  flushQuotaPersistence: () => Promise<void>;
  flushAccountUsagePersistence: () => Promise<void>;
  flushServerWork: () => Promise<void>;
  inFlightSpawnCount: () => number;
  abortSpawns: (errorMessage: string) => void;
  spawnDrainGraceMs: number;
  spawnDrainPollMs: number;
}>;

/** 同一个工厂实例按原顺序接入各阶段；所有方法都必须接真实能力。 */
export type DaemonCapabilities = Readonly<{
  shutdownWork: DaemonShutdownWork;
  initialDaemonStateExtensions: Pick<DaemonState, 'daemonPendingSessionActivationSupported'>;
  startControl: (controlToken: string) => Promise<{ port: number; stop: () => Promise<void> }>;
  startPeer: () => Promise<void>;
  prepareStatePublication: (state: DaemonLocallyPersistedState) => () => void;
  startPublishedCapabilities: () => Promise<Readonly<{
    attachMachine: (registration: DaemonRegistration) => Promise<void>;
  }>>;
  startHeartbeat: (state: DaemonLocallyPersistedState) => NodeJS.Timeout;
  stopBeforeWatchdog: () => void;
  disposeBeforeMachineShutdown: () => Promise<void>;
  detachMachineObserver: () => void;
  disposeAfterMachineShutdown: () => Promise<void>;
  stopPeer: () => Promise<void>;
}>;

/** 只描述产品能力组合，公共启动函数不反向导入默认 CLI 工厂。 */
export type DaemonCapabilityFactory<Api extends DaemonMachineApi> = Readonly<{
  describeEnvironment: () => unknown;
  createApi: (credentials: Credentials) => Promise<Api>;
  initialize: (lifecycle: DaemonLifecycleContext, api: Api) => Promise<DaemonCapabilities>;
}>;
