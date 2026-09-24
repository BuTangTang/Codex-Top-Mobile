import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const LEGACY_MARKER_DIR_NAME = 'daemon-sessions';

export async function resolveDaemonSessionMarkerDirs(happyHomeDir: string): Promise<string[]> {
  const tmpDir = join(happyHomeDir, 'tmp');
  const dirs = [join(tmpDir, LEGACY_MARKER_DIR_NAME)];
  try {
    const entries = await readdir(tmpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith(`${LEGACY_MARKER_DIR_NAME}.`)) continue;
      dirs.push(join(tmpDir, entry.name));
    }
  } catch {
    // tmp dir may not exist yet
  }
  return [...new Set(dirs)];
}
