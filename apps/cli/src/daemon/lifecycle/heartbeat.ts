import type { ApiMachineClient } from '@/api/apiMachine';
import type { DaemonLocallyPersistedState } from '@/persistence';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { gcExecutionRunMarkers } from '@/daemon/executionRunRegistry';
import { findHappyProcessByPid } from '@/daemon/doctor';
import {
  gcWorkspaceReplicationCas,
  gcWorkspaceReplicationJobs,
  recoverWorkspaceReplicationJobsAfterRestart,
} from '@/workspaces/replication/state/workspaceReplicationGc';
import { recoverSessionHandoffPrepareTargetJobsAfterRestart } from '@/session/handoff/prepare/sessionHandoffPrepareTargetJobStore';

import type { TrackedSession } from '../types';
import { createOnChildExited } from '../sessions/onChildExited';
import { requestDaemonSelfRestart } from './requestDaemonSelfRestart';
import {
  startDaemonHeartbeatLoopCore,
  type ReadSessionRunnerProcessIdentity,
  type RequestDaemonSelfRestart,
} from './heartbeatCore';

export { getTrackedSessionHeartbeatPruneReason } from './heartbeatCore';

// 保持原TTL解析规则，所有维护参数仍在启动时采集一次。
function parseNonNegativeInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// 默认入口保留完整维护能力和原公开参数，传输与计时器只有一个所有者。
export function startDaemonHeartbeatLoop(params: Readonly<{
  pidToTrackedSession: Map<number, TrackedSession>;
  spawnResourceCleanupByPid: Map<number, () => void>;
  sessionAttachCleanupByPid: Map<number, () => Promise<void>>;
  getApiMachineForSessions: () => ApiMachineClient | null;
  onChildExited?: (pid: number, exit: Readonly<{ reason: string; code: number | null; signal: string | null }>) => void | Promise<void>;
  controlPort: number;
  fileState: DaemonLocallyPersistedState;
  currentCliVersion: string;
  requestShutdown: (source: 'happier-app' | 'happier-cli' | 'os-signal' | 'exception', errorMessage?: string) => void;
  isShuttingDown?: () => boolean;
  readSessionRunnerProcessIdentity?: ReadSessionRunnerProcessIdentity;
  requestSelfRestart?: RequestDaemonSelfRestart;
}>): NodeJS.Timeout {
  const { pidToTrackedSession } = params;
  const onChildExited =
    params.onChildExited ??
    createOnChildExited({
      pidToTrackedSession: params.pidToTrackedSession,
      spawnResourceCleanupByPid: params.spawnResourceCleanupByPid,
      sessionAttachCleanupByPid: params.sessionAttachCleanupByPid,
      getApiMachineForSessions: params.getApiMachineForSessions,
    });

  return startDaemonHeartbeatLoopCore({
    ...params,
    onChildExited,
    requestSelfRestart: params.requestSelfRestart === undefined ? requestDaemonSelfRestart : params.requestSelfRestart,
    // 在共享核解析原计时参数后创建维护能力，保留原启动采集和执行顺序。
    createMaintenance: () => {
      const executionRunTerminalTtlMs = parseNonNegativeInt(
        process.env.HAPPIER_DAEMON_EXECUTION_RUN_TERMINAL_TTL_MS,
        6 * 60 * 60 * 1000,
      );
      const workspaceReplicationJobTerminalTtlMs = parseNonNegativeInt(
        process.env.HAPPIER_DAEMON_WORKSPACE_REPLICATION_JOB_TERMINAL_TTL_MS,
        14 * 24 * 60 * 60 * 1000,
      );
      const workspaceReplicationCasUnreferencedTtlMs = parseNonNegativeInt(
        process.env.HAPPIER_DAEMON_WORKSPACE_REPLICATION_CAS_UNREFERENCED_TTL_MS,
        14 * 24 * 60 * 60 * 1000,
      );
      const workspaceReplicationCasMaxBytes = parseNonNegativeInt(
        process.env.HAPPIER_DAEMON_WORKSPACE_REPLICATION_CAS_MAX_BYTES,
        0,
      );
      let workspaceReplicationRecoveryPromise: Promise<void> | null = null;
      let sessionHandoffPrepareTargetRecoveryPromise: Promise<void> | null = null;

      const ensureWorkspaceReplicationRecovery = (): Promise<void> => {
        if (workspaceReplicationRecoveryPromise) {
          return workspaceReplicationRecoveryPromise;
        }
        workspaceReplicationRecoveryPromise = (async () => {
          try {
            await recoverWorkspaceReplicationJobsAfterRestart({
              activeServerDir: configuration.activeServerDir,
              nowMs: Date.now(),
            });
          } catch (error) {
            logger.debug('[DAEMON RUN] Failed to recover workspace replication jobs', error);
          }
        })();
        return workspaceReplicationRecoveryPromise;
      };

      const ensureSessionHandoffPrepareTargetRecovery = (): Promise<void> => {
        if (sessionHandoffPrepareTargetRecoveryPromise) {
          return sessionHandoffPrepareTargetRecoveryPromise;
        }
        sessionHandoffPrepareTargetRecoveryPromise = (async () => {
          try {
            await recoverSessionHandoffPrepareTargetJobsAfterRestart({
              activeServerDir: configuration.activeServerDir,
              nowMs: Date.now(),
            });
          } catch (error) {
            logger.debug('[DAEMON RUN] Failed to recover session-handoff prepare-target jobs', error);
          }
        })();
        return sessionHandoffPrepareTargetRecoveryPromise;
      };

      return {
        // 双恢复仍立即并行开始，各自只创建一次Promise。
        startRecovery: () => {
          void ensureWorkspaceReplicationRecovery();
          void ensureSessionHandoffPrepareTargetRecovery();
        },
        // tick仍按工作区、接管任务顺序等待原恢复结果。
        waitForRecovery: async () => {
          await ensureWorkspaceReplicationRecovery();
          await ensureSessionHandoffPrepareTargetRecovery();
        },
        // 保留原三个GC及其独立失败隔离，执行位置仍在PID清理之前。
        afterPrune: async ({ isPidAlive }) => {
          try {
            await gcExecutionRunMarkers({
              nowMs: Date.now(),
              terminalTtlMs: executionRunTerminalTtlMs,
              isPidAlive: (pid) => {
                return isPidAlive(pid);
              },
              isPidSafeHappyProcess: async (pid) => {
                if (pidToTrackedSession.has(pid)) return true;
                const proc = await findHappyProcessByPid(pid);
                return Boolean(proc);
              },
            });
          } catch (error) {
            logger.debug('[DAEMON RUN] Failed to gc execution run markers', error);
          }

          try {
            await gcWorkspaceReplicationJobs({
              activeServerDir: configuration.activeServerDir,
              nowMs: Date.now(),
              terminalTtlMs: workspaceReplicationJobTerminalTtlMs,
            });
          } catch (error) {
            logger.debug('[DAEMON RUN] Failed to gc workspace replication jobs', error);
          }

          try {
            if (workspaceReplicationCasUnreferencedTtlMs > 0 || workspaceReplicationCasMaxBytes > 0) {
              await gcWorkspaceReplicationCas({
                activeServerDir: configuration.activeServerDir,
                nowMs: Date.now(),
                unreferencedTtlMs: workspaceReplicationCasUnreferencedTtlMs,
                ...(workspaceReplicationCasMaxBytes > 0 ? { maxBytes: workspaceReplicationCasMaxBytes } : {}),
              });
            }
          } catch (error) {
            logger.debug('[DAEMON RUN] Failed to gc workspace replication cas', error);
          }
        },
      };
    },
  });
}
