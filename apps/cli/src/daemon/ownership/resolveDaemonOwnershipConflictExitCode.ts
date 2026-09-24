import type { CurrentDaemonOwner } from '@/daemon/ownership/evaluateCurrentDaemonOwner';
import type { DaemonStartupSource } from '@/daemon/ownership/daemonOwnershipMetadata';

export function resolveDaemonOwnershipConflictExitCode(
  startupSource: DaemonStartupSource,
  _owner: CurrentDaemonOwner,
): 0 | 1 {
  return startupSource === 'background-service' ? 0 : 1;
}
