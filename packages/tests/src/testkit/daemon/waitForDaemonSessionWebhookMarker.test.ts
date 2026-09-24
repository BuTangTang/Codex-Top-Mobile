import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { waitForDaemonSessionWebhookMarker } from './waitForDaemonSessionWebhookMarker';

describe('waitForDaemonSessionWebhookMarker', () => {
  it('finds matching markers from scoped daemon-sessions directories', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-daemon-marker-wait-'));
    try {
      const markerDir = join(happyHomeDir, 'tmp', 'daemon-sessions.dev');
      await mkdir(markerDir, { recursive: true });
      await writeFile(join(markerDir, 'pid-12345.json'), JSON.stringify({
        happySessionId: 'sess-scoped',
        metadata: { machineId: 'machine-scoped', lifecycleState: 'running' },
      }), 'utf8');

      await expect(waitForDaemonSessionWebhookMarker({
        happyHomeDir,
        sessionId: 'sess-scoped',
        machineId: 'machine-scoped',
        timeoutMs: 1_000,
        intervalMs: 20,
      })).resolves.toBeUndefined();
    } finally {
      await rm(happyHomeDir, { recursive: true, force: true });
    }
  });

  it('accepts markers without metadata.machineId when session id matches', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-daemon-marker-wait-'));
    try {
      const markerDir = join(happyHomeDir, 'tmp', 'daemon-sessions');
      await mkdir(markerDir, { recursive: true });
      await writeFile(join(markerDir, 'pid-54321.json'), JSON.stringify({
        happySessionId: 'sess-no-machine-id',
        metadata: { lifecycleState: 'starting' },
      }), 'utf8');

      await expect(waitForDaemonSessionWebhookMarker({
        happyHomeDir,
        sessionId: 'sess-no-machine-id',
        machineId: 'expected-machine-id',
        timeoutMs: 1_000,
        intervalMs: 20,
      })).resolves.toBeUndefined();
    } finally {
      await rm(happyHomeDir, { recursive: true, force: true });
    }
  });

  it('accepts persisted session-exit reports when marker files are gone', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-daemon-marker-wait-'));
    try {
      const exitDir = join(happyHomeDir, 'logs', 'session-exit');
      await mkdir(exitDir, { recursive: true });
      await writeFile(join(exitDir, 'session-sess-exit-proof-pid-1001.json'), JSON.stringify({
        sessionId: 'sess-exit-proof',
        observedBy: 'daemon',
      }), 'utf8');

      await expect(waitForDaemonSessionWebhookMarker({
        happyHomeDir,
        sessionId: 'sess-exit-proof',
        machineId: 'expected-machine-id',
        timeoutMs: 1_000,
        intervalMs: 20,
      })).resolves.toBeUndefined();
    } finally {
      await rm(happyHomeDir, { recursive: true, force: true });
    }
  });
});
