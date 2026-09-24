import { startSingleFlightIntervalLoop, type SingleFlightIntervalLoopHandle } from '@/daemon/lifecycle/singleFlightIntervalLoop';

type ConnectedServiceMaterializedHomeCleanupLoopHandle = Readonly<{
  stop: () => void;
  trigger: () => void;
}>;

export function startConnectedServiceMaterializedHomeCleanupLoop(params: Readonly<{
  enabled: boolean;
  tickMs: number;
  scheduler: Readonly<{
    reconcileMaterializedHomes: () => Promise<unknown>;
    cleanupPendingMaterializedHomes: () => Promise<unknown>;
  }>;
  onTickError: (error: unknown) => void;
}>): ConnectedServiceMaterializedHomeCleanupLoopHandle | null {
  if (!params.enabled) return null;

  const loop: SingleFlightIntervalLoopHandle = startSingleFlightIntervalLoop({
    intervalMs: params.tickMs,
    task: async () => {
      await params.scheduler.cleanupPendingMaterializedHomes();
      await params.scheduler.reconcileMaterializedHomes();
    },
    onError: params.onTickError,
    unref: true,
  });

  return {
    stop: () => loop.stop(),
    trigger: () => loop.trigger(),
  };
}
