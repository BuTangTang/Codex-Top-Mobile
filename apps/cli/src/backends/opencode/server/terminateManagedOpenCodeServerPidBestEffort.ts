import { isOpenCodeServerPidAlive } from './openCodeServerProcessState';
import { readPositiveIntEnv } from '@/utils/readPositiveIntEnv';
import { delayUnref } from '@/utils/time';

function trySignalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error: any) {
    if (error?.code === 'ESRCH') return true;
    return false;
  }
}

function trySignalProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error: any) {
    if (error?.code === 'ESRCH') return true;
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs: number, pollMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isOpenCodeServerPidAlive(pid)) return true;
    await delayUnref(pollMs);
  }
  return !isOpenCodeServerPidAlive(pid);
}

export async function terminateManagedOpenCodeServerPidBestEffort(pid: number): Promise<boolean> {
  return await terminateManagedOpenCodeServerPidBestEffortWithOptions(pid, {});
}

export async function terminateManagedOpenCodeServerPidBestEffortWithOptions(
  pid: number,
  options: Readonly<{
    pollMs?: number | null;
    graceMs?: number | null;
    killWaitMs?: number | null;
  }>,
): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (!isOpenCodeServerPidAlive(pid)) return true;

  const pollMs = (typeof options.pollMs === 'number' && options.pollMs > 0)
    ? Math.floor(options.pollMs)
    : (readPositiveIntEnv('HAPPIER_OPENCODE_SERVER_STOP_POLL_MS') ?? 100);
  const graceMs = (typeof options.graceMs === 'number' && options.graceMs > 0)
    ? Math.floor(options.graceMs)
    : (readPositiveIntEnv('HAPPIER_OPENCODE_SERVER_STOP_GRACE_MS') ?? 1_500);
  const killWaitMs = (typeof options.killWaitMs === 'number' && options.killWaitMs > 0)
    ? Math.floor(options.killWaitMs)
    : (readPositiveIntEnv('HAPPIER_OPENCODE_SERVER_STOP_KILL_WAIT_MS') ?? 500);

  if (!trySignalProcessGroup(pid, 'SIGTERM')) {
    trySignalProcess(pid, 'SIGTERM');
  }

  if (await waitForPidExit(pid, graceMs, pollMs)) {
    return true;
  }

  if (!trySignalProcessGroup(pid, 'SIGKILL')) {
    trySignalProcess(pid, 'SIGKILL');
  }

  return await waitForPidExit(pid, killWaitMs, pollMs);
}
