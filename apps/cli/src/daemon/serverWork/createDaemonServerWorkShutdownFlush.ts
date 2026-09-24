import type { DaemonServerWorkScheduler } from './types';

const DEFAULT_DAEMON_SERVER_WORK_SHUTDOWN_FLUSH_TIMEOUT_MS = 2000;

export function createDaemonServerWorkShutdownFlush(params: Readonly<{
  scheduler: Pick<DaemonServerWorkScheduler, 'flushAll'>;
  timeoutMs?: number;
}>): () => Promise<void> {
  const timeoutMs = Math.max(
    0,
    Math.floor(params.timeoutMs ?? DEFAULT_DAEMON_SERVER_WORK_SHUTDOWN_FLUSH_TIMEOUT_MS),
  );
  return async () => {
    await params.scheduler.flushAll(timeoutMs);
  };
}
