import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleText } from '@/testkit/logger/captureOutput';
import type { DaemonRunningInspection } from '@/daemon/controlClient';

const startDaemonMock = vi.fn(async () => undefined);
const inspectDaemonRunningStateMock = vi.fn<() => Promise<DaemonRunningInspection>>(async () => ({ status: 'not-running' }));
vi.mock('@/daemon/startDaemon', () => ({
    startDaemon: startDaemonMock,
}));

vi.mock('@/daemon/controlClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/daemon/controlClient')>();
    return {
        ...actual,
        inspectDaemonRunningStateAndCleanupStaleState: inspectDaemonRunningStateMock,
    };
});

describe('handleDaemonCliCommand: daemon start-sync --takeover', () => {
    const envScope = createEnvKeyScope([
        'HAPPIER_HOME_DIR',
        'HAPPIER_ACTIVE_SERVER_ID',
        'HAPPIER_PUBLIC_RELEASE_CHANNEL',
    ]);

    afterEach(() => {
        envScope.restore();
        startDaemonMock.mockReset();
        inspectDaemonRunningStateMock.mockReset();
        inspectDaemonRunningStateMock.mockImplementation(async () => ({ status: 'not-running' }));
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('takes over a manual daemon and starts the daemon synchronously', async () => {
        await withTempDir('happier-daemon-start-sync-takeover-', async (homeDir) => {
            envScope.patch({
                HAPPIER_HOME_DIR: homeDir,
                HAPPIER_ACTIVE_SERVER_ID: 'cloud',
                HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable',
            });
            vi.resetModules();

            const [{ writeDaemonState }, { handleDaemonCliCommand: reloadedHandleDaemonCliCommand }] = await Promise.all([
                import('@/persistence'),
                import('./daemon'),
            ]);

            const manualOwnedState = {
                pid: process.pid,
                httpPort: 43121,
                startedAt: Date.now(),
                startedWithCliVersion: '0.0.0-other' as const,
                startedWithPublicReleaseChannel: 'preview' as const,
                startupSource: 'manual' as const,
            };
            writeDaemonState(manualOwnedState);
            inspectDaemonRunningStateMock.mockResolvedValue({
                status: 'running',
                state: manualOwnedState,
            });

            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
                throw new Error(`exit:${code ?? ''}`);
            }) as never);
            const output = captureConsoleText();

            try {
                await expect(reloadedHandleDaemonCliCommand({
                    args: ['daemon', 'start-sync', '--takeover'],
                    rawArgv: ['node', 'happier', 'daemon', 'start-sync', '--takeover'],
                    terminalRuntime: null,
                })).rejects.toThrow(/exit:0/);
            } finally {
                output.restore();
                exitSpy.mockRestore();
            }

            expect(startDaemonMock).toHaveBeenCalledTimes(1);
            expect(startDaemonMock).toHaveBeenCalledWith({ takeover: true });
            expect(output.text()).toContain('Taking over the current manual daemon');
        });
    });

    it('takes over a legacy manual daemon without startup metadata and starts the daemon synchronously', async () => {
        await withTempDir('happier-daemon-start-sync-legacy-takeover-', async (homeDir) => {
            envScope.patch({
                HAPPIER_HOME_DIR: homeDir,
                HAPPIER_ACTIVE_SERVER_ID: 'cloud',
                HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable',
            });
            vi.resetModules();

            const [{ writeDaemonState }, { handleDaemonCliCommand: reloadedHandleDaemonCliCommand }] = await Promise.all([
                import('@/persistence'),
                import('./daemon'),
            ]);

            const legacyManualState = {
                pid: process.pid,
                httpPort: 43123,
                startedAt: Date.now(),
                startedWithCliVersion: '0.0.0-other' as const,
                startedWithPublicReleaseChannel: 'preview' as const,
            };
            writeDaemonState(legacyManualState);
            inspectDaemonRunningStateMock.mockResolvedValue({
                status: 'running',
                state: legacyManualState,
            });

            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
                throw new Error(`exit:${code ?? ''}`);
            }) as never);
            const output = captureConsoleText();

            try {
                await expect(reloadedHandleDaemonCliCommand({
                    args: ['daemon', 'start-sync', '--takeover'],
                    rawArgv: ['node', 'happier', 'daemon', 'start-sync', '--takeover'],
                    terminalRuntime: null,
                })).rejects.toThrow(/exit:0/);
            } finally {
                output.restore();
                exitSpy.mockRestore();
            }

            expect(startDaemonMock).toHaveBeenCalledTimes(1);
            expect(startDaemonMock).toHaveBeenCalledWith({ takeover: true });
            expect(output.text()).toContain('Taking over the current manual daemon');
        });
    });
});
