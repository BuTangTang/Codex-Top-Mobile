import { createRelayHostEngine } from '@happier-dev/cli-common/relayHost';
import type { DoctorSnapshot } from '@happier-dev/protocol';

type HappierRelays = NonNullable<NonNullable<DoctorSnapshot['relays']>['happier']>;
type HappierRelay = HappierRelays['relays'][number];
type RelayRing = HappierRelay['ring'];
type RelayScope = HappierRelay['scope'];

const RELAY_RINGS: readonly RelayRing[] = ['stable', 'preview', 'dev'];
const RELAY_SCOPES: readonly RelayScope[] = ['user', 'system'];

const relayHostEngine = createRelayHostEngine({
  installRemoteComponent: async () => {
    throw new Error('Remote component installation is not required for doctor relay inventory');
  },
  resolveRemoteReleaseTarget: async () => {
    throw new Error('Remote relay inventory is not supported in doctor');
  },
  runRemoteText: async () => {
    throw new Error('Remote relay inventory is not supported in doctor');
  },
  copyLocalDirectoryToRemote: async () => {
    throw new Error('Remote relay inventory is not supported in doctor');
  },
});

function shouldIncludeRelay(entry: Readonly<{
  installed: boolean;
  serviceActive: HappierRelay['serviceActive'];
  serviceEnabled: HappierRelay['serviceEnabled'];
  warnings?: HappierRelay['warnings'];
}>): boolean {
  return entry.installed
    || entry.serviceActive !== null
    || entry.serviceEnabled !== null
    || Boolean(entry.warnings?.length);
}

export async function readDoctorRelays(): Promise<HappierRelays> {
  const relays: HappierRelay[] = [];

  for (const ring of RELAY_RINGS) {
    for (const scope of RELAY_SCOPES) {
      const status = await relayHostEngine.readStatus({
        target: { kind: 'local' },
        channel: ring,
        mode: scope,
      });

      const entry: HappierRelay = {
        id: `${ring}:${scope}`,
        ring,
        scope,
        installed: status.installed,
        version: status.version,
        relayUrl: status.baseUrl,
        healthy: typeof status.healthy === 'boolean' ? status.healthy : null,
        serviceActive: status.service.active,
        serviceEnabled: status.service.enabled,
        ...(status.warnings && status.warnings.length > 0 ? { warnings: [...status.warnings] } : {}),
      };

      if (shouldIncludeRelay(entry)) {
        relays.push(entry);
      }
    }
  }

  return { relays };
}
