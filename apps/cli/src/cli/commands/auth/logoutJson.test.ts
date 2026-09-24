import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuration, reloadConfiguration } from '@/configuration';
import { readCredentials, readSettings, updateSettings, writeCredentialsLegacy } from '@/persistence';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleText } from '@/testkit/logger/captureOutput';
import { handleAuthLogout } from './logout';
const fsBoundary = vi.hoisted(() => ({ blockedPath: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
    if (String(path) === fsBoundary.blockedPath) throw new Error('synthetic filesystem failure');
    return actual.unlink(path);
  } };
});
const daemon = vi.hoisted(() => ({ stop: vi.fn(), inspect: vi.fn() }));
vi.mock('@/daemon/controlClient', () => ({ stopDaemon: daemon.stop, inspectDaemonRunningStateAndCleanupStaleState: daemon.inspect }));
const scope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_ACTIVE_SERVER_ID']);
afterEach(() => { scope.restore(); reloadConfiguration(); vi.clearAllMocks(); process.exitCode = undefined; });
describe('current-end JSON logout', () => {
  it('does not report logout success when the credential file could not be removed', async () => {
    await withTempDir('logout-cli-unlink-', async (home) => {
      scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: 'https://synthetic.test', HAPPIER_ACTIVE_SERVER_ID: 'synthetic' }); reloadConfiguration();
      await writeCredentialsLegacy({ token: 'synthetic', secret: new Uint8Array(32).fill(7) });
      daemon.inspect.mockResolvedValue({ status: 'not-running' });
      fsBoundary.blockedPath = configuration.privateKeyFile;
      const output = captureConsoleText();
      try {
        await handleAuthLogout(['--yes', '--json']);
        expect(JSON.parse(output.text())).toMatchObject({ ok: false, error: { code: 'logout_failed' } });
        expect(await readCredentials()).not.toBeNull();
      } finally { output.restore(); fsBoundary.blockedPath = ''; }
    });
  });
  for (const status of ['running', 'not-running']) {
    it(`preserves credentials unless daemon is confirmed stopped: ${status}`, async () => {
      await withTempDir('logout-cli-', async (home) => {
        scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: 'https://synthetic.test', HAPPIER_ACTIVE_SERVER_ID: 'synthetic' }); reloadConfiguration();
        await writeCredentialsLegacy({ token: 'synthetic', secret: new Uint8Array(32).fill(7) });
        await updateSettings((settings) => ({ ...settings, passwordAccountBinding: { accountId: 'a', loginName: 'alice', serverKey: 'https://synthetic.test' } }));
        daemon.inspect.mockResolvedValue({ status });
        const output = captureConsoleText();
        try {
          await handleAuthLogout(['--yes', '--json']);
          expect(JSON.parse(output.text())).toMatchObject(status === 'running' ? { ok: false, error: { code: 'daemon_stop_failed' } } : { ok: true, kind: 'auth_logout', data: { loggedOut: true } });
          expect(Boolean(await readCredentials())).toBe(status === 'running');
          expect((await readSettings()).passwordAccountBinding?.accountId).toBe('a');
        } finally { output.restore(); }
      });
    });
  }
});
