import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/daemon/controlClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/daemon/controlClient')>();
  return {
    ...actual,
    inspectDaemonRunningStateAndCleanupStaleState: vi.fn(async () => ({ status: 'not-running' as const })),
    isDaemonRunningCurrentlyInstalledHappyVersion: vi.fn(),
  };
});

vi.mock('@/daemon/runtime/spawnDetachedDaemonStartSync', () => ({
  spawnDetachedDaemonStartSync: vi.fn(),
}));

import { isDaemonRunningCurrentlyInstalledHappyVersion } from '@/daemon/controlClient';
import { spawnDetachedDaemonStartSync } from '@/daemon/runtime/spawnDetachedDaemonStartSync';

describe('ensureDaemonRunningForSessionCommand', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('polls daemon readiness after spawning', async () => {
    vi.stubEnv('HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS', '50');
    vi.stubEnv('HAPPIER_DAEMON_START_WAIT_POLL_MS', '1');

    const isRunning = vi.mocked(isDaemonRunningCurrentlyInstalledHappyVersion);
    isRunning
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const unref = vi.fn();
    vi.mocked(spawnDetachedDaemonStartSync).mockResolvedValue({ unref } as any);

    const { ensureDaemonRunningForSessionCommand } = await import('./ensureDaemon');
    const promise = ensureDaemonRunningForSessionCommand();
    await promise;

    expect(spawnDetachedDaemonStartSync).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(isRunning).toHaveBeenCalledTimes(3);
  });
});
