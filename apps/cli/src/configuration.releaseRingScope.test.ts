import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';

import { createEnvKeyScope } from '@/testkit/env/envScope';

const envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_RELEASE_RING', 'HOME', 'SUDO_USER', 'SUDO_UID']);

const argvSnapshot = [...process.argv];

describe('configuration daemon ownership paths', () => {
  afterEach(() => {
    envScope.restore();
    process.argv = [...argvSnapshot];
    vi.resetModules();
  });

  it('uses the canonical daemon state and lock file when invoked via the public dev shim name', async () => {
    process.env.HAPPIER_HOME_DIR = '/tmp/happier-test-home';
    delete process.env.HAPPIER_RELEASE_RING;
    process.argv = ['node', '/Users/alice/.happier/bin/hdev', 'daemon', 'status'];

    const { configuration } = await import('./configuration');
    const base = `/tmp/happier-test-home/servers/${configuration.activeServerId}`;
    expect(configuration.daemonStateFile).toBe(`${base}/daemon.state.json`);
    expect(configuration.daemonLockFile).toBe(`${base}/daemon.state.json.lock`);
  });

  it('uses the canonical daemon state and lock file when invoked via the preview shim name', async () => {
    process.env.HAPPIER_HOME_DIR = '/tmp/happier-test-home';
    delete process.env.HAPPIER_RELEASE_RING;
    process.argv = ['node', '/Users/alice/.happier/bin/hprev', 'daemon', 'status'];

    const { configuration } = await import('./configuration');
    const base = `/tmp/happier-test-home/servers/${configuration.activeServerId}`;
    expect(configuration.daemonStateFile).toBe(`${base}/daemon.state.json`);
    expect(configuration.daemonLockFile).toBe(`${base}/daemon.state.json.lock`);
  });

  it('uses the same canonical daemon state filename when invoked via the stable shim name', async () => {
    process.env.HAPPIER_HOME_DIR = '/tmp/happier-test-home';
    delete process.env.HAPPIER_RELEASE_RING;
    process.argv = ['node', '/Users/alice/.happier/bin/happier', 'daemon', 'status'];

    const { configuration } = await import('./configuration');
    const base = `/tmp/happier-test-home/servers/${configuration.activeServerId}`;
    expect(configuration.daemonStateFile).toBe(`${base}/daemon.state.json`);
    expect(configuration.daemonLockFile).toBe(`${base}/daemon.state.json.lock`);
  });

  it('keeps daemon ownership paths server-scoped even when HAPPIER_RELEASE_RING=dev is set', async () => {
    process.env.HAPPIER_HOME_DIR = '/tmp/happier-test-home';
    process.env.HAPPIER_RELEASE_RING = 'dev';
    process.argv = ['node', '/usr/local/bin/node', 'daemon', 'status'];

    const { configuration } = await import('./configuration');
    const base = `/tmp/happier-test-home/servers/${configuration.activeServerId}`;
    expect(configuration.daemonStateFile).toBe(`${base}/daemon.state.json`);
  });

  it('expands ~/ HAPPIER_HOME_DIR before deriving configuration paths', async () => {
    const homeDir = createTempDirSync('happier-config-home-');
    try {
      process.env.HOME = homeDir;
      process.env.HAPPIER_HOME_DIR = '~/happier-test-home';
      delete process.env.HAPPIER_RELEASE_RING;
      process.argv = ['node', '/usr/local/bin/node', 'daemon', 'status'];

      const { configuration } = await import('./configuration');
      expect(configuration.happyHomeDir).toBe(`${homeDir}/happier-test-home`);
    } finally {
      removeTempDirSync(homeDir);
    }
  });

  it('rejects a Windows-shaped HAPPIER_HOME_DIR on non-Windows hosts', async () => {
    process.env.HAPPIER_HOME_DIR = 'C:\\Users\\tester\\.happier';
    delete process.env.HAPPIER_RELEASE_RING;
    process.argv = ['node', '/usr/local/bin/node', 'daemon', 'status'];

    await expect(import('./configuration')).rejects.toThrow(/windows/i);
  });

  it('prefers the sudo invoker home over root when invoked under sudo and no explicit home override is set', async () => {
    const rootHomeDir = createTempDirSync('happier-config-root-home-');
    const sudoHomeDir = createTempDirSync('happier-config-sudo-home-');
    const originalGetuid = typeof process.getuid === 'function' ? process.getuid : undefined;
    try {
      process.env.HOME = rootHomeDir;
      delete process.env.HAPPIER_HOME_DIR;
      delete process.env.HAPPIER_RELEASE_RING;
      process.env.SUDO_USER = 'developer';
      process.env.SUDO_UID = '1000';
      process.argv = ['node', '/usr/local/bin/node', 'service', 'list'];

      Object.defineProperty(process, 'getuid', { value: () => 0 });

      vi.resetModules();
      vi.doMock('node:fs', async () => {
        const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
        return {
          ...actual,
          readFileSync: (path: unknown, options: unknown) => {
            if (String(path) === '/etc/passwd') {
              return `developer:x:1000:1000::${sudoHomeDir}:/bin/bash\n`;
            }
            // @ts-expect-error - pass-through to the real fs implementation for all other paths
            return actual.readFileSync(path, options);
          },
        };
      });

      const { configuration } = await import('./configuration');
      const { existsSync } = await import('node:fs');

      expect(configuration.happyHomeDir).toBe(`${sudoHomeDir}/.happier`);
      expect(existsSync(`${rootHomeDir}/.happier`)).toBe(false);
      expect(existsSync(`${sudoHomeDir}/.happier`)).toBe(true);
    } finally {
      if (originalGetuid) {
        Object.defineProperty(process, 'getuid', { value: originalGetuid });
      }
      vi.doUnmock('node:fs');
      vi.resetModules();
      removeTempDirSync(rootHomeDir);
      removeTempDirSync(sudoHomeDir);
    }
  });
});
