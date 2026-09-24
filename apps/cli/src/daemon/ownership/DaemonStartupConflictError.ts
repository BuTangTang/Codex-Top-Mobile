import type { DaemonServiceListEntry } from '@/daemon/service/cli';
import { renderDaemonInstalledServiceConflict } from '@/daemon/ownership/daemonServiceInventory';

export class DaemonStartupConflictError extends Error {
  public readonly title: string;
  public readonly lines: readonly string[];
  public readonly services: readonly DaemonServiceListEntry[];

  public constructor(params: Readonly<{
    action: 'daemon-start' | 'daemon-start-sync' | 'session-autostart';
    services: readonly DaemonServiceListEntry[];
  }>) {
    const message = renderDaemonInstalledServiceConflict(params);
    super([message.title, ...message.lines].join(' '));
    this.name = 'DaemonStartupConflictError';
    this.title = message.title;
    this.lines = message.lines;
    this.services = params.services;
  }
}
