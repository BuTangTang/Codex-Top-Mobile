import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { captureConsoleText } from '@/testkit/logger/captureOutput';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { dispatchCodexTopCli } from './productCommandRegistry';

const processes = vi.hoisted(() => ({ spawnSync: vi.fn(() => ({ status: 0, signal: null, error: undefined })) }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawnSync: processes.spawnSync,
}));

afterEach(() => vi.restoreAllMocks());

describe('Codex Top command surface', () => {
  it('rejects generic commands instead of exposing the default plugin catalog', async () => {
    const output = captureConsoleText();
    try {
      await expect(dispatchCodexTopCli({
        args: ['plugins', 'list', '--json'], rawArgv: ['codex-top', 'plugins', 'list', '--json'], terminalRuntime: null,
      })).rejects.toThrow('Unsupported Codex Top command: plugins');
      expect(output.text()).not.toContain('plugins_list');
    } finally {
      output.restore();
    }
  });

  it('prints the product command surface without generic session commands', async () => {
    const output = captureConsoleText();
    try {
      await dispatchCodexTopCli({ args: ['--help'], rawArgv: ['codex-top', '--help'], terminalRuntime: null });
      expect(output.text()).toContain('Codex Top connection');
      expect(output.text()).toContain('codex-top codex');
      expect(output.text()).not.toContain('happier session');
    } finally {
      output.restore();
    }
  });

  it('rejects other providers and inherited property names before any process launch', async () => {
    processes.spawnSync.mockClear();
    for (const command of ['claude', 'codex-x', 'toString', 'self']) {
      await expect(dispatchCodexTopCli({ args: [command], rawArgv: ['codex-top', command], terminalRuntime: null }))
        .rejects.toThrow(`Unsupported Codex Top command: ${command}`);
    }
    expect(processes.spawnSync).not.toHaveBeenCalled();
  });

  it('keeps original auth and internal daemon handlers reachable without running services', async () => {
    await withTempDir('product-command-owner-', async (home) => {
      const env = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_TAILSCALE_AUTO_PUBLIC_URL']);
      const output = captureConsoleText();
      env.patch({ HAPPIER_HOME_DIR: home, HAPPIER_TAILSCALE_AUTO_PUBLIC_URL: '0' });
      vi.resetModules();
      try {
        const { dispatchCodexTopCli: dispatch } = await import('./productCommandRegistry');
        await dispatch({ args: ['auth', '--help'], rawArgv: ['codex-top', 'auth', '--help'], terminalRuntime: null });
        for (const command of ['start-sync', 'restart']) {
          await dispatch({ args: ['daemon', command, '--help'], rawArgv: ['codex-top', 'daemon', command, '--help'], terminalRuntime: null });
        }
        expect(output.text()).toContain('happier auth');
        expect(output.text()).toContain('daemon start-sync');
        expect(output.text()).toContain('daemon restart');
      } finally {
        output.restore(); env.restore(); vi.resetModules();
      }
    });
  }, 30_000);

  it('routes managed Codex arguments through the real parser and provider help boundary', async () => {
    await withTempDir('product-codex-owner-', async (home) => {
      const executable = join(home, 'synthetic-codex');
      writeFileSync(executable, '#!/bin/sh\nexit 0\n'); chmodSync(executable, 0o700);
      const env = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_CODEX_PATH', 'HAPPIER_TAILSCALE_AUTO_PUBLIC_URL', 'HAPPIER_SESSION_AUTOSTART_DAEMON']);
      const output = captureConsoleText();
      env.patch({ HAPPIER_HOME_DIR: home, HAPPIER_CODEX_PATH: executable, HAPPIER_TAILSCALE_AUTO_PUBLIC_URL: '0' });
      vi.resetModules(); processes.spawnSync.mockClear();
      try {
        const { dispatchCodexTopCli: dispatch } = await import('./productCommandRegistry');
        const args = ['codex', '--started-by', 'daemon', '--happy-starting-mode', 'remote', '--permission-mode', 'yolo', '--model', 'synthetic-model', '-C', home, 'exec', '--sandbox', 'workspace-write', '--help'];
        await dispatch({ args, rawArgv: ['codex-top', ...args], terminalRuntime: null });
        expect(processes.spawnSync).toHaveBeenCalledWith(executable,
          ['--model', 'synthetic-model', 'exec', '--sandbox', 'workspace-write', '--help'],
          expect.objectContaining({ stdio: 'inherit' }));
        expect(args).toEqual(['codex', '--started-by', 'daemon', '--happy-starting-mode', 'remote', '--permission-mode', 'yolo', '--model', 'synthetic-model', '-C', home, 'exec', '--sandbox', 'workspace-write', '--help']);
      } finally {
        output.restore(); env.restore(); vi.resetModules();
      }
    });
  }, 30_000);
});
