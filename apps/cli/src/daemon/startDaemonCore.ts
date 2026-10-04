import { randomBytes, randomUUID } from 'node:crypto';
import { getReleaseRingCatalogEntry } from '@happier-dev/release-runtime/releaseRings';
import { isMachineContentPublicKeyMismatchError } from '@/api/machine/machineRegistrationErrors';
import { serializeAxiosErrorForLog } from '@/api/client/serializeAxiosErrorForLog';
import { ensureMachineRegistered } from '@/api/machine/ensureMachineRegistered';
import { MachineMetadata, DaemonState } from '@/api/types';
import { logger } from '@/ui/logger';
import { authAndSetupMachineIfNeeded } from '@/ui/auth';
import { configuration, reloadConfiguration } from '@/configuration';
import { startCaffeinate, stopCaffeinate } from '@/integrations/caffeinate';
import packageJson from '../../package.json';
import { writeDaemonStateIfLockOwned, DaemonLocallyPersistedState, acquireDaemonLock, releaseDaemonLock, clearDaemonState, readCredentials } from '@/persistence';
import { getDaemonShutdownExitCode, getDaemonShutdownWatchdogTimeoutMs } from './shutdownPolicy';
import { shouldRetryMachineRegistrationError } from './machineRegistrationRetryPolicy';
import { computeRestartDelayMs } from '@/subprocess/supervision/backoff';
import { resolveDaemonTakeoverRequestedFromEnv, resolveDaemonServiceLabelFromEnv, resolveDaemonStartupSourceFromEnv } from '@/daemon/ownership/daemonOwnershipMetadata';
import { evaluateCurrentDaemonOwner } from '@/daemon/ownership/evaluateCurrentDaemonOwner';
import { DaemonOwnershipConflictError } from '@/daemon/ownership/DaemonOwnershipConflictError';
import { DaemonStartupConflictError } from '@/daemon/ownership/DaemonStartupConflictError';
import { evaluateDaemonStartupServiceConflict } from '@/daemon/ownership/daemonServiceInventory';
import {
  buildDaemonTakeoverNotice,
  resolveDaemonTakeoverDecision,
} from '@/daemon/ownership/resolveDaemonTakeoverDecision';
import { resolveDaemonOwnershipConflictExitCode } from '@/daemon/ownership/resolveDaemonOwnershipConflictExitCode';
import { resolveDaemonServiceCliRuntimeFromEnv } from '@/daemon/service/cli';
import { forceStopKnownDaemonPid, isDaemonRunningCurrentlyInstalledHappyVersion, stopDaemon } from './controlClient';
import { runMachineBootstrap } from './lifecycle/runMachineBootstrap';
import { requestDaemonSelfRestartWithLockHandoff } from './lifecycle/requestDaemonSelfRestartWithLockHandoff';
import { assertCurrentDaemonSelfRestartAuthorization } from './lifecycle/selfRestartAuthorization';
import { resolveDaemonSelfRestartExpectedCliVersion } from './lifecycle/resolveDaemonSelfRestartExpectedCliVersion';
import { reapSameHomeDaemonOrphansBeforeStart } from './multiDaemon';
import { publishShutdownStateBestEffort } from './lifecycle/publishShutdownState';
import { getPreferredHostName, initialMachineMetadata } from './machine/metadata';
import { createDaemonShutdownController } from './lifecycle/shutdown';
import { resolveWaitForAuthConfig } from './startup/waitForAuthConfig';
import { waitForInitialCredentials } from './startup/waitForInitialCredentials';
import { resolveDaemonDiagnosticSubsystemGates } from './startup/diagnosticSubsystemGates';
import { resolveStartDaemonMachinePreflightDecision } from './startup/machinePreflightDecision';
import type { DaemonCapabilities, DaemonCapabilityFactory, DaemonLifecycleContext, DaemonMachineApi } from './lifecycle/daemonCapabilities';

/** 读取现有整数环境配置，默认入口与公共生命周期共用同一实现。 */
export function resolvePositiveIntEnv(raw: string | undefined, fallback: number, bounds: { min: number; max: number }): number {
  const value = (raw ?? '').trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}

/** 等待现有重试间隔或关闭请求，沿用同一可取消计时器，不阻塞退出。 */
export async function sleepMsOrShutdown(delayMs: number, shutdownPromise: Promise<unknown>): Promise<'elapsed' | 'shutdown'> {
  if (delayMs <= 0) return 'elapsed';
  return await new Promise<'elapsed' | 'shutdown'>((resolveSleep) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      resolveSleep('elapsed');
    }, delayMs);
    timeout.unref?.();
    void shutdownPromise.then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveSleep('shutdown');
    });
  });
}


/** 执行唯一启动和关闭生命周期，真实能力由调用方在原阶段组合。 */
export async function startDaemonCore<Api extends DaemonMachineApi>(factory: DaemonCapabilityFactory<Api>, options: Readonly<{ takeover?: boolean }> = {}): Promise<void> {
  // We don't have cleanup function at the time of server construction
  // Control flow is:
  // 1. Create promise that will resolve when shutdown is requested
  // 2. Setup signal handlers to resolve this promise with the source of the shutdown
  // 3. Once our setup is complete - if all goes well - we await this promise
  // 4. When it resolves we can cleanup and exit
  //
  const {
    requestShutdown,
    isShutdownRequested: isDaemonShutdownRequested = () => false,
    resolvesWhenShutdownRequested,
  } = createDaemonShutdownController();

  logger.debug('[DAEMON RUN] Starting daemon process...');
  logger.debugLargeJson('[DAEMON RUN] Environment', factory.describeEnvironment());
  const diagnosticSubsystemGates = resolveDaemonDiagnosticSubsystemGates(process.env);

  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const { waitForAuthEnabled, waitForAuthTimeoutMs } = resolveWaitForAuthConfig(process.env);

  let daemonLockHandle: Awaited<ReturnType<typeof acquireDaemonLock>> = null;
  let publishedDaemonStateOwner: Readonly<{ pid: number; startedAt: number }> | null = null;
  const inheritedRuntimeId = String(process.env.HAPPIER_DAEMON_RUNTIME_ID ?? '').trim();
  const runtimeId = inheritedRuntimeId || randomUUID();
  const startupSource = resolveDaemonStartupSourceFromEnv(process.env);
  const selfRestartCorrelationId = String(process.env.HAPPIER_DAEMON_SELF_RESTART_CORRELATION_ID ?? '').trim();
  assertCurrentDaemonSelfRestartAuthorization({
    startupSource,
    correlationId: selfRestartCorrelationId,
    deadlineMs: process.env.HAPPIER_DAEMON_SELF_RESTART_DEADLINE_MS,
  });
  const serviceLabel = resolveDaemonServiceLabelFromEnv(process.env);
  const takeoverRequested = startupSource === 'self-restart'
    ? true
    : options.takeover ?? resolveDaemonTakeoverRequestedFromEnv(process.env);

  try {
    const ownership = await evaluateCurrentDaemonOwner();
    const takeoverDecision = resolveDaemonTakeoverDecision({
      ownership,
      takeoverRequested,
      startupSource,
    });
    if (takeoverDecision.kind === 'conflict') {
      const error = new DaemonOwnershipConflictError({
        intent: 'daemon-start',
        owner: takeoverDecision.owner,
      });
      logger.warn('[DAEMON RUN] Daemon ownership conflict prevented daemon startup', {
        title: error.title,
        lines: error.lines,
      });
      throw error;
    }

    const startupServiceConflict = await evaluateDaemonStartupServiceConflict({
      startupSource,
      runtime: resolveDaemonServiceCliRuntimeFromEnv({ processEnv: process.env }),
    });
    if (startupServiceConflict.kind === 'installed-background-service-conflict') {
      const error = new DaemonStartupConflictError({
        action: 'daemon-start-sync',
        services: startupServiceConflict.services,
      });
      logger.warn('[DAEMON RUN] Installed background service prevented manual daemon startup', {
        title: error.title,
        lines: error.lines,
      });
      throw error;
    }

    if (takeoverDecision.kind === 'manual-owner-takeover' || takeoverDecision.kind === 'manual-owner-replace') {
      const takeoverNotice = buildDaemonTakeoverNotice({ action: 'start-sync' });
      logger.warn(
        takeoverDecision.kind === 'manual-owner-takeover'
          ? '[DAEMON RUN] Daemon takeover requested; replacing the current manual daemon runtime'
          : '[DAEMON RUN] Replacing the current stale manual daemon runtime before startup',
        {
          runtimeId,
          ownerCliVersion: takeoverDecision.owner.state.startedWithCliVersion,
          ownerReleaseChannel: takeoverDecision.owner.state.startedWithPublicReleaseChannel,
          title: takeoverNotice.title,
          lines: takeoverNotice.lines,
        },
      );
      await stopDaemon();
      if (takeoverDecision.owner.source === 'process') {
        await forceStopKnownDaemonPid(takeoverDecision.owner.state.pid);
      }
    }

    const preservedOwnerPids =
      ownership.kind === 'compatible' || (ownership.kind === 'conflict' && takeoverDecision.kind === 'ok')
        ? [ownership.owner.state.pid]
        : [];
    try {
      const orphanReapResult = await reapSameHomeDaemonOrphansBeforeStart({
        preservePids: preservedOwnerPids,
      });
      if (
        orphanReapResult.stoppedPids.length > 0
        || orphanReapResult.failedPids.length > 0
      ) {
        logger.debug('[DAEMON RUN] Same-home daemon orphan reap complete', orphanReapResult);
      }
    } catch (error) {
      logger.warn('[DAEMON RUN] Same-home daemon orphan reap failed', error);
    }

    const credentialsGate = await waitForInitialCredentials({
      isInteractive,
      waitForAuthEnabled,
      waitForAuthTimeoutMs,
      credentialsPath: configuration.privateKeyFile,
      refresh: () => reloadConfiguration(),
      readCredentials,
      acquireDaemonLock: () => acquireDaemonLock(5, 200),
      releaseDaemonLock,
      resolvesWhenShutdownRequested,
      logger,
      daemonLockHandle,
    });
    if (credentialsGate.action === 'exit') {
      process.exit(credentialsGate.exitCode);
    }
    if (credentialsGate.action === 'shutdown') {
      return;
    }
    daemonLockHandle = credentialsGate.daemonLockHandle;

    // Ensure auth and machine registration BEFORE we take the daemon lock.
    // This prevents stuck lock files when auth is interrupted or cannot proceed.
    const auth = await authAndSetupMachineIfNeeded();
    const credentials = auth.credentials;
    let machineId = auth.machineId;
    logger.debug('[DAEMON RUN] Auth and machine setup complete');

    const api = await factory.createApi(credentials);
    const preferredHost = await getPreferredHostName();
    const metadataForRegistration: MachineMetadata = { ...initialMachineMetadata, host: preferredHost };
    let preflightMachineRegistration: Awaited<ReturnType<typeof ensureMachineRegistered>> | null = null;

    const runningDaemonVersionMatches = await isDaemonRunningCurrentlyInstalledHappyVersion({
      expectedMachineId: machineId,
    });
    const machinePreflightDecision = resolveStartDaemonMachinePreflightDecision({
      runningDaemonVersionMatches,
      startupSource,
    });
    if (machinePreflightDecision === 'stop_current_daemon') {
      logger.debug('[DAEMON RUN] Daemon version or machine identity mismatch detected, restarting daemon with current CLI version');
      await stopDaemon();
    } else if (machinePreflightDecision === 'skip_sync_preflight_for_self_restart') {
      logger.debug('[DAEMON RUN] Self-restart replacement detected matching daemon; skipping synchronous machine preflight and continuing takeover');
    } else {
      preflightMachineRegistration = await ensureMachineRegistered({
        api,
        machineId,
        metadata: metadataForRegistration,
        caller: 'startDaemon preflight',
      });
      machineId = preflightMachineRegistration.machineId;
      if (preflightMachineRegistration.didRotateMachineId) {
        logger.debug('[DAEMON RUN] Same-version daemon matched a stale machine id, restarting daemon with recovered machine identity');
        await stopDaemon();
        preflightMachineRegistration = null;
      } else {
        logger.debug('[DAEMON RUN] Daemon version and machine identity match, keeping existing daemon');
        console.log('Daemon already running with matching version');
        process.exit(0);
      }
    }

    // Acquire exclusive lock (proves daemon is running)
    if (!daemonLockHandle) {
      daemonLockHandle = await acquireDaemonLock(5, 200);
    }
    if (!daemonLockHandle) {
      logger.debug('[DAEMON RUN] Daemon lock file already held, another daemon is running');
      process.exit(0);
    }

    // Start caffeinate
    const caffeinateStarted = startCaffeinate();
    if (caffeinateStarted) {
      logger.debug('[DAEMON RUN] Sleep prevention enabled');
    }

    let capabilities: DaemonCapabilities;
    let beforeShutdownOnce: Promise<void> | null = null;
    const lifecycle: DaemonLifecycleContext = {
      credentials, runtimeId, startupSource, serviceLabel, preferredHost,
      diagnosticSubsystemGates, takeoverRequested,
      requestShutdown, isDaemonShutdownRequested, resolvesWhenShutdownRequested,
      state: {
        get machineId() { return machineId; },
        set machineId(value) { machineId = value; },
        apiMachine: null,
        shutdownInitiated: false,
      },
      beforeShutdown,
      requestSelfRestart: async (selfRestartParams) => await requestDaemonSelfRestartWithLockHandoff({
        getCurrentDaemonLockHandle: () => daemonLockHandle,
        setCurrentDaemonLockHandle: (lockHandle) => { daemonLockHandle = lockHandle; },
        releaseDaemonLock,
        acquireDaemonLock: () => acquireDaemonLock(5, 200),
        requestShutdown,
        selfRestartParams,
      }),
    };
        async function beforeShutdown(): Promise<void> {
	          if (beforeShutdownOnce) return await beforeShutdownOnce;
	          beforeShutdownOnce = (async () => {
	            await capabilities.shutdownWork.quiesceProducers();
	            await capabilities.shutdownWork.flushQuotaPersistence();
            await capabilities.shutdownWork.flushAccountUsagePersistence();
	            await capabilities.shutdownWork.flushServerWork();
            const initialInFlightSpawns = capabilities.shutdownWork.inFlightSpawnCount();
            const hasPendingRpcRequests = lifecycle.state.apiMachine !== null;
            if (initialInFlightSpawns === 0 && !hasPendingRpcRequests) return;

            logger.debug('[DAEMON RUN] Shutdown requested with in-flight work; deferring shutdown', {
              inFlightSpawns: initialInFlightSpawns,
              pendingRpcDrainEnabled: hasPendingRpcRequests,
              graceMs: capabilities.shutdownWork.spawnDrainGraceMs,
              pollMs: capabilities.shutdownWork.spawnDrainPollMs,
            });

            const start = Date.now();
            while (capabilities.shutdownWork.inFlightSpawnCount() > 0 && Date.now() - start < capabilities.shutdownWork.spawnDrainGraceMs) {
              // eslint-disable-next-line no-await-in-loop
              await new Promise((resolve) => setTimeout(resolve, capabilities.shutdownWork.spawnDrainPollMs));
            }

            const remaining = capabilities.shutdownWork.inFlightSpawnCount();
            if (remaining === 0) {
              logger.debug('[DAEMON RUN] In-flight spawn(s) drained; checking pending RPC requests');
            } else {
              const errorMessage = `Daemon shutting down while ${remaining} spawn(s) still awaiting session webhook.`;
              logger.warn('[DAEMON RUN] In-flight spawn(s) did not drain before shutdown; aborting spawn(s)', {
                inFlight: remaining,
                graceMs: capabilities.shutdownWork.spawnDrainGraceMs,
              });

              capabilities.shutdownWork.abortSpawns(errorMessage);
            }

            if (!lifecycle.state.apiMachine) return;

            const elapsedMs = Date.now() - start;
            const remainingRpcGraceMs = Math.max(0, capabilities.shutdownWork.spawnDrainGraceMs - elapsedMs);
            if (remainingRpcGraceMs === 0) {
              logger.warn('[DAEMON RUN] No shutdown grace budget left to drain pending RPC requests');
              return;
            }

            let rpcRequestsDrained = false;
            const timeoutHandle = setTimeout(() => {
              if (!rpcRequestsDrained) {
                logger.warn('[DAEMON RUN] Pending RPC requests did not drain before shutdown', {
                  graceMs: remainingRpcGraceMs,
                });
              }
            }, remainingRpcGraceMs);

            try {
              await Promise.race([
                lifecycle.state.apiMachine.awaitPendingRpcRequests().then(() => {
                  rpcRequestsDrained = true;
                }),
                new Promise<void>((resolve) => setTimeout(resolve, remainingRpcGraceMs)),
              ]);
            } finally {
              clearTimeout(timeoutHandle);
            }

            if (rpcRequestsDrained) {
              logger.debug('[DAEMON RUN] Pending RPC requests drained; proceeding with shutdown');
            }

            await capabilities.shutdownWork.flushQuotaPersistence();
            await capabilities.shutdownWork.flushServerWork();
          })();
          return await beforeShutdownOnce;
        }
    capabilities = await factory.initialize(lifecycle, api);
    const controlToken = randomBytes(32).toString('base64url');
    const { port: controlPort, stop: stopControlServer } = await capabilities.startControl(controlToken);
    await capabilities.startPeer();
    // Persist daemon.state.json after the control server is available so:
    // - `happier daemon status` can reliably detect the running process, and
    // - callers can reach `/ping` even if machine registration is slow/unavailable.
    //
    // Note: the presence of daemon.state.json does NOT imply that machine sync is ready.
    const daemonStateCliVersion = resolveDaemonSelfRestartExpectedCliVersion({
      currentCliVersion: packageJson.version,
    });
    const fileState: DaemonLocallyPersistedState = {
      pid: process.pid,
      httpPort: controlPort,
      startedAt: Date.now(),
      startedWithCliVersion: daemonStateCliVersion,
      startedWithPublicReleaseChannel: getReleaseRingCatalogEntry(configuration.publicReleaseRing).publicLabel,
      runtimeId,
      ...(selfRestartCorrelationId ? { selfRestartCorrelationId } : {}),
      startupSource,
      serviceLabel,
      machineId: lifecycle.state.machineId,
      daemonLogPath: logger.logFilePath,
      controlToken,
    };
    const afterStatePublished = capabilities.prepareStatePublication(fileState);
    let didWriteDaemonState = false;
    const writeDaemonStateOnce = () => {
      if (didWriteDaemonState) return;
      didWriteDaemonState = true;
      if (!writeDaemonStateIfLockOwned(fileState)) {
        throw new Error('Daemon state publication rejected because the process no longer owns the lifecycle lock');
      }
      publishedDaemonStateOwner = {
        pid: fileState.pid,
        startedAt: fileState.startedAt,
      };
      afterStatePublished();
      logger.debug('[DAEMON RUN] Daemon state written');
    };
    writeDaemonStateOnce();
	        // Prepare initial daemon state
	        const initialDaemonState: DaemonState = {
          status: 'offline',
          pid: process.pid,
          httpPort: controlPort,
          startedAt: Date.now(),
          startedWithCliVersion: daemonStateCliVersion,
          ...capabilities.initialDaemonStateExtensions,
        };

    const publishedCapabilities = await capabilities.startPublishedCapabilities();
      const machineRegistrationTimeoutMs = resolvePositiveIntEnv(
        process.env.HAPPIER_DAEMON_MACHINE_REGISTRATION_TIMEOUT_MS,
        10_000,
        { min: 250, max: 120_000 },
      );
      const machineRegistrationRetryBaseDelayMs = resolvePositiveIntEnv(
        process.env.HAPPIER_DAEMON_MACHINE_REGISTRATION_RETRY_BASE_DELAY_MS
          ?? process.env.HAPPIER_DAEMON_MACHINE_REGISTRATION_RETRY_DELAY_MS,
        10_000,
        { min: 0, max: 5 * 60_000 },
      );
      const machineRegistrationRetryMaxDelayMs = resolvePositiveIntEnv(
        process.env.HAPPIER_DAEMON_MACHINE_REGISTRATION_RETRY_MAX_DELAY_MS,
        5 * 60_000,
        { min: 0, max: 30 * 60_000 },
      );
      const machineRegistrationRetryJitterMs = resolvePositiveIntEnv(
        process.env.HAPPIER_DAEMON_MACHINE_REGISTRATION_RETRY_JITTER_MS,
        1_000,
        { min: 0, max: 60_000 },
      );
      const machineRegistrationRetryEffectiveMaxDelayMs = Math.max(
        machineRegistrationRetryBaseDelayMs,
        machineRegistrationRetryMaxDelayMs,
      );
      const machineRegistrationMaxAttempts = resolvePositiveIntEnv(
        process.env.HAPPIER_DAEMON_MACHINE_REGISTRATION_MAX_ATTEMPTS,
        0,
        { min: 0, max: 10_000 },
      );

      // Do machine bootstrap in the background so shutdown requests are not blocked by /v1/machines latency.
      void runMachineBootstrap({
        getPreflightRegistration: () => preflightMachineRegistration,
        clearPreflightRegistration: () => { preflightMachineRegistration = null; },
        isShuttingDown: () => lifecycle.state.shutdownInitiated,
        ensureRegistered: () => ensureMachineRegistered({
              api,
              machineId: lifecycle.state.machineId,
              metadata: metadataForRegistration,
              daemonState: initialDaemonState,
              timeoutMs: machineRegistrationTimeoutMs,
              caller: 'startDaemon',
            }),
        publishRegisteredIdentity: (ensured) => {
            const ensuredMachineId = ensured.machineId;
            if (fileState.machineId !== ensuredMachineId) {
              const nextState: DaemonLocallyPersistedState = {
                ...fileState,
                machineId: ensuredMachineId,
              };
              if (!writeDaemonStateIfLockOwned(nextState)) {
                return false;
              }
              fileState.machineId = ensuredMachineId;
            }
            lifecycle.state.machineId = ensuredMachineId;
            return true;
        },
        attachMachine: (ensured) => publishedCapabilities.attachMachine(ensured),
        retry: {
          maxAttempts: machineRegistrationMaxAttempts,
          shouldRetry: shouldRetryMachineRegistrationError,
          delayForAttempt: (attempts) => Math.min(
              machineRegistrationRetryEffectiveMaxDelayMs,
              computeRestartDelayMs({
                attempt: attempts,
                baseDelayMs: machineRegistrationRetryBaseDelayMs,
                maxDelayMs: machineRegistrationRetryEffectiveMaxDelayMs,
                jitterMs: machineRegistrationRetryJitterMs,
                random: () => Math.random(),
              }),
            ),
          wait: (retryDelayMs) => sleepMsOrShutdown(retryDelayMs, resolvesWhenShutdownRequested),
          reportRejected: (error) => {
              logger.warn('[DAEMON RUN] Machine registration rejected (non-retryable); giving up', {
                ...(isMachineContentPublicKeyMismatchError(error) ? { reason: error.reason } : {}),
                ...(serializeAxiosErrorForLog(error) as any),
              });
          },
          reportExhausted: (attempts) => {
              logger.warn('[DAEMON RUN] Machine registration failed too many times; giving up', {
                attempt: attempts,
              });
          },
          reportRetry: (error, attempts, retryDelayMs) => {
            // IMPORTANT: Do not log raw Axios errors here; they can contain bearer tokens.
            logger.warn(
              '[DAEMON RUN] Machine registration unavailable; retrying',
              {
                attempt: attempts,
                retryDelayMs,
                error: serializeAxiosErrorForLog(error),
              },
            );
          },
        },
      });

    const restartOnStaleVersionAndHeartbeat = capabilities.startHeartbeat(fileState);
                const cleanupAndShutdown = async (source: 'happier-app' | 'happier-cli' | 'os-signal' | 'exception', errorMessage?: string) => {
          lifecycle.state.shutdownInitiated = true;
          capabilities.stopBeforeWatchdog();
          const exitCode = getDaemonShutdownExitCode(source);
          const shutdownWatchdog = setTimeout(async () => {
            logger.debug(`[DAEMON RUN] Shutdown timed out, forcing exit with code ${exitCode}`);
            await new Promise((resolve) => setTimeout(resolve, 100));
            process.exit(exitCode);
          }, getDaemonShutdownWatchdogTimeoutMs());
          shutdownWatchdog.unref?.();

          logger.debug(`[DAEMON RUN] Starting proper cleanup (source: ${source}, errorMessage: ${errorMessage})...`);

          // Clear health check interval
          if (restartOnStaleVersionAndHeartbeat) {
            clearInterval(restartOnStaleVersionAndHeartbeat);
        logger.debug('[DAEMON RUN] Health check interval cleared');
      }

      // Clear daemon.state.json early in shutdown so callers observing "stop" don't race a later
      // heartbeat tick or long tail cleanup work (and to satisfy daemon stop integration tests).
      try {
        const didClearOwnedDaemonState = await clearDaemonState({
          expectedOwner: {
            pid: fileState.pid,
            startedAt: fileState.startedAt,
          },
        });
        if (didClearOwnedDaemonState) {
          publishedDaemonStateOwner = null;
        }
        logger.debug(
          didClearOwnedDaemonState
            ? '[DAEMON RUN] Daemon state file removed'
            : '[DAEMON RUN] Daemon state file preserved because shutdown no longer owns the publication',
        );
      } catch (error) {
        logger.debug('[DAEMON RUN] Error cleaning up daemon metadata', error);
      }
      try {
        await beforeShutdown();
      } catch (error) {
        logger.warn('[DAEMON RUN] Before-shutdown work failed during cleanup', serializeAxiosErrorForLog(error));
      }
      await capabilities.disposeBeforeMachineShutdown();

      if (lifecycle.state.apiMachine) {
        capabilities.detachMachineObserver();
          const daemonStateUpdateTimeoutMs = resolvePositiveIntEnv(
            process.env.HAPPIER_DAEMON_SHUTDOWN_STATE_UPDATE_TIMEOUT_MS,
            250,
            { min: 50, max: 30_000 },
          );

          await publishShutdownStateBestEffort({
            apiMachine: lifecycle.state.apiMachine,
            source,
            timeoutMs: daemonStateUpdateTimeoutMs,
            warn: (message, error) => {
              if (error !== undefined) {
                logger.warn(message, error);
                return;
              }
              logger.warn(message);
            },
          });
      }
      await capabilities.disposeAfterMachineShutdown();
      await capabilities.stopPeer();
      await stopControlServer();
          await stopCaffeinate();
          if (daemonLockHandle) {
            await releaseDaemonLock(daemonLockHandle);
          }

          logger.debug('[DAEMON RUN] Cleanup completed, exiting process');
          clearTimeout(shutdownWatchdog);
          process.exit(exitCode);
        };

    logger.debug('[DAEMON RUN] Daemon started successfully, waiting for shutdown request');

    // Wait for shutdown request
    const shutdownRequest = await resolvesWhenShutdownRequested;
    await cleanupAndShutdown(shutdownRequest.source, shutdownRequest.errorMessage);
  } catch (error) {
    if (daemonLockHandle) {
      if (publishedDaemonStateOwner) {
        try {
          await clearDaemonState({
            expectedOwner: publishedDaemonStateOwner,
          });
          publishedDaemonStateOwner = null;
        } catch {
          // The process is terminating; lock release must still run so a later daemon can recover.
        }
      }
      try {
        await releaseDaemonLock(daemonLockHandle);
      } catch {
        // ignore
      }
    }
    if (error instanceof DaemonOwnershipConflictError) {
      process.exit(resolveDaemonOwnershipConflictExitCode(startupSource, error.owner));
    }
    if (error instanceof DaemonStartupConflictError) {
      process.exit(1);
    }
    // IMPORTANT: Do not log raw Axios errors here; they can contain bearer tokens.
    logger.debug('[DAEMON RUN][FATAL] Failed somewhere unexpectedly - exiting with code 1', serializeAxiosErrorForLog(error));
    process.exit(1);
  }
}
