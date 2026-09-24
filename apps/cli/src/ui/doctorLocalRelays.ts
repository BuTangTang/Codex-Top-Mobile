import chalk from 'chalk';

import type { DoctorSnapshot } from '@/ui/doctorSnapshot';
import { formatReleaseChannel } from '@/ui/format/releaseChannel';

type LocalRelay = NonNullable<NonNullable<NonNullable<DoctorSnapshot['relays']>['happier']>['relays'][number]>;

type PublicReleaseChannel = 'stable' | 'preview' | 'dev';

function dim(text: string): string {
  return chalk.dim(chalk.gray(text));
}

function formatRelayServiceState(relay: LocalRelay): string {
  const parts: string[] = [];
  if (relay.serviceActive === true) {
    parts.push('running');
  } else if (relay.serviceActive === false) {
    parts.push('stopped');
  }
  if (relay.serviceEnabled === true) {
    parts.push('enabled');
  } else if (relay.serviceEnabled === false) {
    parts.push('disabled');
  }
  return parts.join(', ') || 'unknown';
}

function formatRelayHealth(relay: LocalRelay): string {
  if (relay.healthy === true) return 'healthy';
  if (relay.healthy === false) return 'unhealthy';
  return 'unknown';
}

function hasInstalledRelayOnChannel(relays: readonly LocalRelay[], channel: PublicReleaseChannel): boolean {
  return relays.some((relay) => relay.installed === true && relay.ring === channel);
}

function inferInstalledChannels(relays: readonly LocalRelay[]): PublicReleaseChannel[] {
  const seen = new Set<PublicReleaseChannel>();
  for (const relay of relays) {
    if (relay.installed !== true) continue;
    if (relay.ring === 'stable' || relay.ring === 'preview' || relay.ring === 'dev') {
      seen.add(relay.ring);
    }
  }
  return [...seen].sort();
}

export function formatDoctorLocalRelayLines(
  relays: readonly LocalRelay[],
  options?: Readonly<{
    currentCliReleaseChannel?: PublicReleaseChannel | null;
  }>,
): string[] {
  const lines = [chalk.bold('Local relay installs:')];

  if (relays.length === 0) {
    lines.push(chalk.gray('  (none)'));
    return lines;
  }

  for (const relay of relays) {
    lines.push(`  • ${chalk.bold(formatReleaseChannel(relay.ring))} ${dim(`(${relay.scope})`)} ${dim('→')} ${relay.relayUrl}`);
    if (relay.installed !== true) lines.push(dim('    • Installed: no'));
    if (relay.version) lines.push(dim(`    • Version: ${relay.version}`));
    lines.push(dim(`    • Service: ${formatRelayServiceState(relay)}`));
    lines.push(dim(`    • Health: ${formatRelayHealth(relay)}`));
    for (const warning of relay.warnings ?? []) lines.push(chalk.yellow(`    • Warning: ${warning}`));
  }

  const currentCliReleaseChannel = options?.currentCliReleaseChannel ?? null;
  if (currentCliReleaseChannel && relays.some((relay) => relay.installed === true)) {
    if (!hasInstalledRelayOnChannel(relays, currentCliReleaseChannel)) {
      const installedChannels = inferInstalledChannels(relays)
        .map((channel) => formatReleaseChannel(channel))
        .join(dim(', '));
      lines.push('');
      lines.push(chalk.yellow(`  • Tip: you have local relays for ${installedChannels}, but this CLI is ${formatReleaseChannel(currentCliReleaseChannel)}.`));
      lines.push(dim(`    • If you use a local relay, install the ${currentCliReleaseChannel} relay: happier relay host install --channel ${currentCliReleaseChannel}`));
    }
  }

  return lines;
}
