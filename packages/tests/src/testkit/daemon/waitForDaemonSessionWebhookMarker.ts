import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from '../timing';
import { resolveDaemonSessionMarkerDirs } from './sessionMarkerDirs';

type DaemonSessionMarkerLike = Readonly<{
  happySessionId?: unknown;
  metadata?: Readonly<{
    machineId?: unknown;
    lifecycleState?: unknown;
  }> | null;
}>;

export async function waitForDaemonSessionWebhookMarker(params: Readonly<{
  happyHomeDir: string;
  sessionId: string;
  machineId: string;
  timeoutMs?: number;
  intervalMs?: number;
}>): Promise<void> {
  const sessionExitDir = join(params.happyHomeDir, 'logs', 'session-exit');
  const sessionExitPrefix = `session-${params.sessionId}-pid-`;
  await waitFor(async () => {
    const markerDirs = await resolveDaemonSessionMarkerDirs(params.happyHomeDir);

    for (const markerDir of markerDirs) {
      let entries: string[] = [];
      try {
        entries = await readdir(markerDir);
      } catch {
        continue;
      }

      for (const name of entries) {
        if (!name.startsWith('pid-') || !name.endsWith('.json')) continue;

        let parsed: DaemonSessionMarkerLike | null = null;
        try {
          parsed = JSON.parse(await readFile(join(markerDir, name), 'utf8')) as DaemonSessionMarkerLike;
        } catch {
          continue;
        }

        const sessionId = typeof parsed.happySessionId === 'string' ? parsed.happySessionId.trim() : '';
        const machineId = typeof parsed.metadata?.machineId === 'string' ? parsed.metadata.machineId.trim() : '';
        if (sessionId !== params.sessionId) continue;
        if (machineId.length > 0 && machineId !== params.machineId) continue;
        return true;
      }
    }

    try {
      const exitEntries = await readdir(sessionExitDir);
      if (exitEntries.some((name) => name.startsWith(sessionExitPrefix) && name.endsWith('.json'))) {
        return true;
      }
    } catch {
      // session-exit dir may not exist yet
    }

    return false;
  }, {
    timeoutMs: params.timeoutMs ?? 30_000,
    intervalMs: params.intervalMs ?? 100,
    context: `daemon session webhook marker for ${params.sessionId}`,
  });
}
